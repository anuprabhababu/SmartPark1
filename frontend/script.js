const $ = (selector) => document.querySelector(selector);

let charts = { assigned: null, cost: null, time: null };
let lastAllocationAssignments=[];
let animationRunId = 0;

async function api(url, options = {}) {
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
}


function esc(value){
    return String(value ?? "").replace(/[&<>"']/g, function (character) {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}


function fmt(value, digits = 2) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : "0";
}

function message(text, type = "success") {
    const element = $("#message");
    if (!element) return;
    element.textContent = text;
    element.className = `message ${type}`;
    element.classList.remove("hidden");
}

function requirement(vehicle) {
    const requirements = [];
    if (vehicle.size === "LARGE") requirements.push("Large vehicle");
    if (vehicle.needsEV) requirements.push("EV charging");
    if (vehicle.needsAccessible) requirements.push("Accessible");
    return requirements.join(", ") || "Normal";
}

function renderVehicles(vehicles, spaces) {
    const table = $("#vehicleTable");
    if (!table) return;

    if (!vehicles.length) {
        table.innerHTML = `<tr><td colspan="6" class="empty-cell">No vehicle requests yet. Add a vehicle to get started.</td></tr>`;
        $("#resultsCount").textContent = "0 records";
        return;
    }

    table.innerHTML = [...vehicles].reverse().map((vehicle) => {
        const status = String(vehicle.status || "PENDING");
        const statusClass = `status-${status.toLowerCase()}`;
        let action = "—";

        if (status === "PARKED") {
            action = `<button class="small-button" data-depart="${esc(vehicle.id)}">Mark departed</button>`;
        } else if (status === "PENDING" || status === "WAITING") {
            action = '<span class="muted">Awaiting allocation</span>';
        }

        const assignedSpace = vehicle.spaceId || "—";
        const space = spaces.find((item) => item.id === vehicle.spaceId);
        const distance = space ? `${space.distance} m` : "—";

        return `<tr>
      <td><strong>${esc(vehicle.name)}</strong><br><span class="muted">${esc(vehicle.id)}</span></td>
      <td>${esc(requirement(vehicle))}</td>
      <td>${esc(assignedSpace)}</td><td>${esc(distance)}</td>
      <td><span class="status ${statusClass}">${esc(status)}</span></td><td>${action}</td>
    </tr>`;
    }).join("");

    $("#resultsCount").textContent = `${vehicles.length} records`;
}

async function refresh() {
    const state = await api("/api/state");
    const spaces = Array.isArray(state.spaces) ? state.spaces : [];
    const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
    const summary = state.summary || {};

    $("#totalSpaces").textContent = summary.totalSpaces ?? spaces.length;
    $("#availableSpaces").textContent = summary.availableSpaces ?? spaces.filter(s => s.available).length;
    $("#occupiedSpaces").textContent = summary.occupiedSpaces ?? spaces.filter(s => !s.available).length;
    $("#pendingVehicles").textContent = summary.pendingVehicles ?? vehicles.filter(v => ["PENDING", "WAITING"].includes(v.status)).length;
    $("#parkingSubtitle").textContent = `${summary.totalSpaces ?? spaces.length} spaces · live status`;

    renderAnimationSlots(spaces, vehicles);
    renderVehicles(vehicles, spaces);
}

function renderAnimationSlots(spaces, vehicles) {
    const container = $("#parkingGrid");
    if (!container) return;

    const parkedBySpace = new Map(
        vehicles.filter(v => v.status === "PARKED" && v.spaceId).map(v => [v.spaceId, v])
    );

    container.innerHTML = spaces.map((space) => {
        const vehicle = parkedBySpace.get(space.id);
        const specialClass = space.type === "EV" ? "ev" : space.type === "ACCESSIBLE" ? "accessible" : "";
        const occupiedClass = vehicle ? "occupied slot-filled" : "available";
        return `<div class="space animation-slot ${occupiedClass} ${specialClass}" data-animation-slot="${esc(space.id)}">
      <span class="car-icon slot-car">${vehicle ? "🚗" : "🅿️"}</span>
      <span class="space-id slot-label">${esc(space.id)}</span>
      <span class="space-type">${esc(space.type === "NORMAL" ? "Normal" : space.type)}</span>
      <span class="space-distance">${esc(space.distance)} m</span>
      <span class="slot-owner">${vehicle ? esc(vehicle.name) : "Available"}</span>
    </div>`;
    }).join("");
}

function destroyCharts() {
    Object.keys(charts).forEach((key) => {
        if (charts[key]) charts[key].destroy();
        charts[key] = null;
    });
}

function clearComparison() {
    destroyCharts();
    $("#comparisonCards").innerHTML = `
    <div class="metric-card"><span>Greedy assigned</span><strong>—</strong></div>
    <div class="metric-card"><span>Hungarian assigned</span><strong>—</strong></div>
    <div class="metric-card"><span>Greedy cost</span><strong>—</strong></div>
    <div class="metric-card"><span>Hungarian cost</span><strong>—</strong></div>
    <div class="metric-card"><span>Currently parked</span><strong>—</strong></div>`;
}


function makeBarChart(
    canvasId,
    label,
    greedyValue,
    hungarianValue,
    suffix = "",
    colors = ["#2866d8", "#16a078"]
) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return null;

    return new Chart(canvas, {
        type: "bar",
        data: {
            labels: ["Greedy", "Hungarian"],
            datasets: [{
                label,
                data: [greedyValue, hungarianValue],
                backgroundColor: colors,
                borderRadius: 7,
                borderSkipped: false,
                maxBarThickness: 58
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 650 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.raw}${suffix}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#617384",
                        font: { weight: 700 }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: "#edf1f4" },
                    ticks: {
                        color: "#718292",
                        precision: suffix === " vehicles" ? 0 : undefined
                    },
                    title: {
                        display: true,
                        text: label,
                        color: "#718292",
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

function renderComparison(data, parkedCountOverride) {
    if (!data?.greedy || !data?.hungarian ){
        console.error("Unexpected /api/compare response:", data);
        message("The comparison API returned an unexpected response.", "error");
        return false;
    }

    const greedy = data.greedy;
    const hungarian = data.hungarian;
    const parkedCount = Number.isFinite(parkedCountOverride) ?
        parkedCountOverride :
        Number(data.parkedVehicleCount ?? 0);

    const gAssigned = Number(greedy.vehiclesAssigned ?? 0);
    const hAssigned = Number(hungarian.vehiclesAssigned ?? 0);
    const gUnassigned = Number(greedy.vehiclesUnassigned ?? 0);
    const hUnassigned = Number(hungarian.vehiclesUnassigned ?? 0);
    const gCost = Number(greedy.totalCost ?? 0);
    const hCost = Number(hungarian.totalCost ?? 0);
    const gTime = Number(greedy.executionTimeMs ?? 0);
    const hTime = Number(hungarian.executionTimeMs ?? 0);

    $("#comparisonCards").innerHTML = `
    <div class="metric-card"><span>Greedy assigned</span><strong>${gAssigned}</strong></div>
    <div class="metric-card"><span>Hungarian assigned</span><strong>${hAssigned}</strong></div>
    <div class="metric-card"><span>Greedy cost</span><strong>${fmt(gCost, 1)}</strong></div>
    <div class="metric-card"><span>Hungarian cost</span><strong>${fmt(hCost, 1)}</strong></div>
    <div class="metric-card"><span>Currently parked</span><strong>${parkedCount}</strong></div>`;

    destroyCharts();
    charts.assigned = makeBarChart("assignedChart", "Vehicles assigned", gAssigned, hAssigned, " vehicles");
    charts.cost = makeBarChart("costChart", "Total cost", gCost, hCost, " cost units", ["#e49a42", "#8b6ad9"]);
    charts.time = makeBarChart("timeChart", "Execution time", gTime, hTime, " ms", ["#3979b8", "#19a18b"]);

    // Keep unassigned counts visible in the status message when useful.
    const compareNote = $("#comparisonNote");
    if (compareNote) {
        compareNote.textContent = `Unassigned in this preview — Greedy: ${gUnassigned}; Hungarian: ${hUnassigned}.`;
    }

    return true;
}

async function loadComparison(showMessage = false) {
    const [data, state] = await Promise.all([api("/api/compare"), api("/api/state")]);
    const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
    const parkedCount = vehicles.filter(v => v.status === "PARKED").length;
    renderComparison(data, parkedCount);
    if (showMessage) message("Comparison updated. The parking state was not changed.");
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetAnimationView() {
    animationRunId++;
    $("#animationCars").innerHTML = "";
    $("#animationStatus").textContent = "Ready";
    $("#animationMessage").textContent = "Visual reset only. Actual parking assignments have not changed.";
    await refresh();
}

async function playParkingAnimation(assignments = lastAllocationAssignments) {
    const assigned = (assignments || []).filter(a => a.status === "Assigned" && a.spaceId);
    const unassigned = (assignments || []).filter(a => a.status !== "Assigned" || !a.spaceId);
    if (!assignments || assignments.length === 0) {
        message("There is no saved allocation to animate. Add vehicles and run an allocation first.", "error");
        return;
    }

    const runId = ++animationRunId;
    const stage = $("#animationStage");
    const layer = $("#animationCars");
    const button = $("#playAnimationBtn");
    button.disabled = true;
    layer.innerHTML = "";
    $("#animationStatus").textContent = "In progress";
    $("#animationMessage").textContent = `Starting animation for ${assigned.length} assigned vehicle(s)…`;

    try {
        const state = await api("/api/state");
        renderAnimationSlots(state.spaces || [], state.vehicles || []);

        // The backend has already committed the allocation. Temporarily clear only
        // the visual target slots so the moving icons visibly arrive in one shared lot.
        for (const assignment of assigned) {
            const target = stage.querySelector(`[data-animation-slot="${CSS.escape(assignment.spaceId)}"]`);
            if (!target) continue;
            target.classList.remove("occupied", "slot-filled");
            target.classList.add("available");
            const icon = target.querySelector(".slot-car");
            const owner = target.querySelector(".slot-owner");
            if (icon) icon.textContent = "🅿️";
            if (owner) owner.textContent = "Waiting for vehicle…";
        }

        for (let i = 0; i < assigned.length; i++) {
            if (runId !== animationRunId) return;
            const assignment = assigned[i];
            const target = stage.querySelector(`[data-animation-slot="${CSS.escape(assignment.spaceId)}"]`);
            if (!target) continue;

            const car = document.createElement("div");
            car.className = "moving-car";
            car.innerHTML = `<span class="car-emoji">🚗</span><span class="car-name">${esc(assignment.vehicleName || assignment.vehicleId)}</span>`;
            layer.appendChild(car);

            // Start the car in the lane beneath the entrance label.
            car.style.left = "calc(50% - 60px)";
            car.style.top = "12px";
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (runId !== animationRunId) return;

            const stageRect = stage.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const carRect = car.getBoundingClientRect();
            const left = targetRect.left - stageRect.left + (targetRect.width - carRect.width) / 2;
            const top = targetRect.top - stageRect.top + (targetRect.height - carRect.height) / 2;

            $("#animationMessage").textContent = `${assignment.vehicleName || assignment.vehicleId} is moving to ${assignment.spaceId}…`;
            car.style.left = `${left}px`;
            car.style.top = `${top}px`;
            await sleep(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 30 : 1050);
            if (runId !== animationRunId) return;

            car.remove();
            target.classList.add("slot-filled", "occupied");
            target.classList.remove("available");
            const owner = target.querySelector(".slot-owner");
            const icon = target.querySelector(".slot-car");
            if (owner) owner.textContent = assignment.vehicleName || assignment.vehicleId;
            if (icon) icon.textContent = "🚗";
            await sleep(170);
        }

        if (runId !== animationRunId) return;
        $("#animationStatus").textContent = "Completed";
        $("#animationMessage").textContent =
            `Playback complete: ${assigned.length} assigned, ${unassigned.length} unassigned. This visual replays the allocation returned by the server.`;
    } catch (error) {
        console.error("Animation error:", error);
        message(`Could not play animation: ${error.message}`, "error");
    } finally {
        if (runId === animationRunId) button.disabled = false;
    }
}

// Welcome page -> dashboard
$("#enterAppBtn").addEventListener("click", async() => {
    $("#welcomeScreen").classList.add("hidden");
    $("#appScreen").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "instant" });
    try {
        await refresh();
        clearComparison();
    } catch (error) {
        message(`Could not load SmartPark: ${error.message}`, "error");
    }
});

$("#homeBtn").addEventListener("click", () => {
    $("#appScreen").classList.add("hidden");
    $("#welcomeScreen").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
});

// Add vehicle
$("#vehicleForm").addEventListener("submit", async(event) => {
    event.preventDefault();
    const name = $("#vehicleName").value.trim();
    const size = $("#vehicleSize").value;
    const needsEV = $("#needsEV").checked;
    const needsAccessible = $("#needsAccessible").checked;

    if (!name) return message("Please enter a vehicle name.", "error");
    if (needsEV && needsAccessible) {
        return message("This demo has no combined EV-accessible spaces. Choose one requirement.", "error");
    }

    try {
        await api("/api/vehicles", {
            method: "POST",
            body: JSON.stringify({ name, size, needsEV, needsAccessible })
        });
        event.target.reset();
        await refresh();
        clearComparison();
        message("Vehicle request added. Click Compare Algorithms to view the comparison.");
    } catch (error) {
        message(error.message, "error");
    }
});

// Run only the selected algorithm. Comparison graphs are shown only when
// the user clicks "Compare Algorithms".
$("#runBtn").addEventListener("click", async () => {
    const button = $("#runBtn");
    button.disabled = true;
    button.textContent = "Allocating…";

    try {
        const response = await api("/api/allocate", {
            method: "POST",
            body: JSON.stringify({ algorithm: $("#algorithmSelect").value })
        });

        const result = response.result;
        if (!result) {
            throw new Error("Allocation response is missing its result.");
        }

        lastAllocationAssignments = Array.isArray(result.assignments)
            ? result.assignments
            : [];

        await refresh();

        // Clear old comparison results after allocation; do not compare automatically.
        clearComparison();
        const note = $("#comparisonNote");
        if (note) {
            note.textContent = "No comparison yet. Click Compare Algorithms to compare both algorithms.";
        }

        message(
            `${result.algorithm}: ${result.vehiclesAssigned} assigned, ` +
            `${result.vehiclesUnassigned} unassigned. Total cost: ${fmt(result.totalCost, 1)}.`
        );

        await playParkingAnimation(lastAllocationAssignments);
    } catch (error) {
        message(error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Run allocation →";
    }
});

// Preview both algorithms on the same pending vehicles and available spaces.
$("#compareBtn").addEventListener("click", async() => {
    try {
        await loadComparison(false);
        message("Comparison complete. This preview did not change parking assignments.");
    } catch (error) {
        message(error.message, "error");
    }
});

$("#playAnimationBtn").addEventListener("click", () => playParkingAnimation());
$("#resetAnimationBtn").addEventListener("click", () => resetAnimationView().catch(error => message(error.message, "error")));

// Departure
$("#vehicleTable").addEventListener("click", async(event) => {
    const button = event.target.closest("[data-depart]");
    if (!button) return;

    try {
        const response = await api(`/api/depart/${encodeURIComponent(button.dataset.depart)}`, { method: "POST" });
        await refresh();
        clearComparison();
        message((response.message || "Vehicle departure recorded.") + " Click Compare Algorithms to refresh the graphs.");
    } catch (error) {
        message(error.message, "error");
    }
});

// Reset the simulation
$("#resetBtn").addEventListener("click", async() => {
    if (!confirm("Reset the simulation and make all spaces available? This clears all vehicle requests and history.")) return;

    try {
        animationRunId++;
        lastAllocationAssignments = [];
        await api("/api/reset", { method: "POST" });
        $("#animationCars").innerHTML = "";
        $("#animationStatus").textContent = "Ready";
        $("#animationMessage").textContent = "Run an allocation to create a playback.";
        clearComparison();
        await refresh();
        message("Simulation reset. All parking spaces are available.");
    } catch (error) {
        message(error.message, "error");
    }
});

// App loads the welcome page first; API data loads when user enters dashboard.