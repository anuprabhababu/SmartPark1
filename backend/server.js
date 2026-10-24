require("dotenv").config();

const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { performance } = require("perf_hooks");

const { connectDatabase, Vehicle, ParkingSpace, AllocationHistory } = require("./database");
const { greedyAllocate, hungarianAllocate, runAlgorithm } = require("./algorithms");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

function publicVehicle(vehicle) {
  const item = typeof vehicle.toObject === "function" ? vehicle.toObject() : vehicle;
  delete item._id;
  delete item.__v;
  delete item.createdAt;
  delete item.updatedAt;
  return item;
}

function publicSpace(space) {
  const item = typeof space.toObject === "function" ? space.toObject() : space;
  delete item._id;
  delete item.__v;
  delete item.createdAt;
  delete item.updatedAt;
  return item;
}

async function getState() {
  const [spaceDocs, vehicleDocs, historyDocs] = await Promise.all([
    ParkingSpace.find().sort({ id: 1 }).lean(),
    Vehicle.find({ status: { $ne: "DEPARTED" } }).sort({ createdAt: 1 }).lean(),
    AllocationHistory.find().sort({ createdAt: -1 }).limit(100).lean()
  ]);
  const spaces = spaceDocs.map(publicSpace);
  const vehicles = vehicleDocs.map(publicVehicle);
  const history = historyDocs.map((entry) => entry.result);

  return {
    spaces,
    vehicles,
    history,
    summary: {
      totalSpaces: spaces.length,
      availableSpaces: spaces.filter((space) => space.available).length,
      occupiedSpaces: spaces.filter((space) => !space.available).length,
      pendingVehicles: vehicles.filter((vehicle) => ["PENDING", "WAITING"].includes(vehicle.status)).length,
      parkedVehicles: vehicles.filter((vehicle) => vehicle.status === "PARKED").length
    }
  };
}

function getPendingAndAvailable(vehicles, spaces) {
  return {
    pending: vehicles.filter((vehicle) => ["PENDING", "WAITING"].includes(vehicle.status)),
    available: spaces.filter((space) => space.available)
  };
}

// GET: current persisted state
app.get("/api/state", async (req, res) => {
  try {
    res.json(await getState());
  } catch (error) {
    console.error("State error:", error);
    res.status(500).json({ error: "Could not load SmartPark state." });
  }
});

// POST: register and persist a vehicle
app.post("/api/vehicles", async (req, res) => {
  try {
    const { name, size = "NORMAL", needsEV = false, needsAccessible = false } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "Enter a vehicle name or ID." });
    if (!["NORMAL", "LARGE"].includes(size)) return res.status(400).json({ error: "Invalid vehicle size." });
    if (needsEV && needsAccessible) {
      return res.status(400).json({ error: "This demo has no combined EV-accessible spaces. Choose one requirement." });
    }

    const vehicle = await Vehicle.create({
      id: `V-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: String(name).trim(), size,
      needsEV: Boolean(needsEV),
      needsAccessible: Boolean(needsAccessible),
      status: "PENDING", spaceId: null
    });
    res.status(201).json({ message: "Vehicle request added successfully.", vehicle: publicVehicle(vehicle), state: await getState() });
  } catch (error) {
    console.error("Vehicle creation error:", error);
    res.status(500).json({ error: "Could not save the vehicle to MongoDB." });
  }
});

// GET: compare both algorithms without changing or saving parking assignments
app.get("/api/compare", async (req, res) => {
  try {
    const [vehicleDocs, spaceDocs] = await Promise.all([
      Vehicle.find({ status: { $in: ["PENDING", "WAITING"] } }).sort({ createdAt: 1 }).lean(),
      ParkingSpace.find({ available: true }).sort({ id: 1 }).lean()
    ]);
    const pending = vehicleDocs.map(publicVehicle);
    const available = spaceDocs.map(publicSpace);

    let start = performance.now();
    const greedy = greedyAllocate(pending, available);
    greedy.executionTimeMs = Number((performance.now() - start).toFixed(4));

    start = performance.now();
    const hungarian = hungarianAllocate(pending, available);
    hungarian.executionTimeMs = Number((performance.now() - start).toFixed(4));

    const parkedVehicleCount = await Vehicle.countDocuments({ status: "PARKED" });
    res.json({ greedy, hungarian, pendingCount: pending.length, availableCount: available.length, parkedVehicleCount });
  } catch (error) {
    console.error("Comparison error:", error);
    res.status(500).json({ error: "Could not compare allocation algorithms.", details: error.message });
  }
});

// POST: commit one selected algorithm's allocation to MongoDB
app.post("/api/allocate", async (req, res) => {
  try {
    const algorithm = String(req.body?.algorithm || "greedy").toLowerCase();
    if (!["greedy", "hungarian"].includes(algorithm)) return res.status(400).json({ error: "Choose greedy or hungarian." });

    const [vehicleDocs, spaceDocs] = await Promise.all([
      Vehicle.find({ status: { $in: ["PENDING", "WAITING"] } }).sort({ createdAt: 1 }).lean(),
      ParkingSpace.find({ available: true }).sort({ id: 1 }).lean()
    ]);
    const pending = vehicleDocs.map(publicVehicle);
    const available = spaceDocs.map(publicSpace);

    const start = performance.now();
    const result = runAlgorithm(algorithm, pending, available);
    result.executionTimeMs = Number((performance.now() - start).toFixed(4));

    // Update only the assignments returned by the selected algorithm.
    for (const assignment of result.assignments || []) {
      const vehicle = pending.find((item) => item.id === assignment.vehicleId);
      if (!vehicle) continue;

      if (assignment.status === "Assigned" && assignment.spaceId) {
        // Conditional update prevents two vehicles taking the same space.
        const claimedSpace = await ParkingSpace.findOneAndUpdate(
          { id: assignment.spaceId, available: true },
          { $set: { available: false } },
          { new: true }
        );
        if (claimedSpace) {
          await Vehicle.updateOne(
            { id: vehicle.id, status: { $in: ["PENDING", "WAITING"] } },
            { $set: { status: "PARKED", spaceId: claimedSpace.id } }
          );
        } else {
          assignment.status = "Unassigned";
          assignment.spaceId = null;
          await Vehicle.updateOne({ id: vehicle.id }, { $set: { status: "WAITING", spaceId: null } });
        }
      } else {
        await Vehicle.updateOne({ id: vehicle.id }, { $set: { status: "WAITING", spaceId: null } });
      }
    }

    result.timestamp = new Date().toISOString();
    await AllocationHistory.create({ algorithm: result.algorithm || algorithm, timestamp: result.timestamp, result });
    res.json({ message: "Parking allocation completed.", result, state: await getState() });
  } catch (error) {
    console.error("Allocation error:", error);
    res.status(500).json({ error: "Could not complete parking allocation.", details: error.message });
  }
});

// POST: persist departure and release the space
app.post("/api/depart/:id", async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ id: req.params.id, status: "PARKED" });
    if (!vehicle || !vehicle.spaceId) return res.status(404).json({ error: "No parked vehicle found with that ID." });

    const releasedSpace = vehicle.spaceId;
    await ParkingSpace.updateOne({ id: releasedSpace }, { $set: { available: true } });
    vehicle.status = "DEPARTED";
    vehicle.spaceId = null;
    await vehicle.save();

    res.json({ message: `${vehicle.name} departed. ${releasedSpace} is available again.`, state: await getState() });
  } catch (error) {
    console.error("Departure error:", error);
    res.status(500).json({ error: "Could not record vehicle departure." });
  }
});

// POST: reset current simulation records and restore the fixed space layout
app.post("/api/reset", async (req, res) => {
  try {
    await Promise.all([
      Vehicle.deleteMany({}),
      AllocationHistory.deleteMany({}),
      ParkingSpace.updateMany({}, { $set: { available: true } })
    ]);
    res.json({ message: "Simulation reset successfully.", state: await getState() });
  } catch (error) {
    console.error("Reset error:", error);
    res.status(500).json({ error: "Could not reset the simulation." });
  }
});

// Serve the frontend for non-API routes
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

async function startServer() {
  try {
    await connectDatabase();
    app.listen(PORT, () => console.log(`SmartPark running at http://localhost:${PORT}`));
  } catch (error) {
    console.error("Could not start SmartPark:", error.message);
    process.exit(1);
  }
}

startServer();
