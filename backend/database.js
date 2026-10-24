const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true },
  size: { type: String, enum: ["NORMAL", "LARGE"], default: "NORMAL" },
  needsEV: { type: Boolean, default: false },
  needsAccessible: { type: Boolean, default: false },
  status: { type: String, enum: ["PENDING", "WAITING", "PARKED", "DEPARTED"], default: "PENDING" },
  spaceId: { type: String, default: null }
}, { timestamps: true, versionKey: false });

const parkingSpaceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  type: { type: String, enum: ["NORMAL", "EV", "ACCESSIBLE", "LARGE"], required: true },
  distance: { type: Number, required: true },
  available: { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });

const allocationHistorySchema = new mongoose.Schema({
  algorithm: { type: String, default: "Comparison" },
  timestamp: { type: String, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, versionKey: false });

const Vehicle = mongoose.models.Vehicle || mongoose.model("Vehicle", vehicleSchema);
const ParkingSpace = mongoose.models.ParkingSpace || mongoose.model("ParkingSpace", parkingSpaceSchema);
const AllocationHistory = mongoose.models.AllocationHistory || mongoose.model("AllocationHistory", allocationHistorySchema);

const INITIAL_SPACES = [
  ["P1", "NORMAL", 8], ["P2", "NORMAL", 12], ["P3", "NORMAL", 18],
  ["P4", "NORMAL", 24], ["P5", "NORMAL", 30], ["P6", "NORMAL", 35],
  ["P7", "EV", 10], ["P8", "EV", 22], ["P9", "ACCESSIBLE", 6],
  ["P10", "LARGE", 28], ["P11", "NORMAL", 40], ["P12", "NORMAL", 45]
].map(([id, type, distance]) => ({ id, type, distance, available: true }));

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing. Add it to your .env file or hosting environment variables.");
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);

  // Seed the fixed parking layout only if the collection is empty.
  const spaceCount = await ParkingSpace.countDocuments();
  if (spaceCount === 0) {
    await ParkingSpace.insertMany(INITIAL_SPACES);
    console.log("Created the initial 12 SmartPark parking spaces.");
  }
}

module.exports = { connectDatabase, mongoose, Vehicle, ParkingSpace, AllocationHistory };
