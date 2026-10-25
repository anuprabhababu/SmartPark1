const { performance } = require("perf_hooks");

const INF = 1e8;

function hungarian(matrix) {
    const n = matrix.length;
    const m = matrix[0].length;
    const u = Array(n + 1).fill(0);
    const v = Array(m + 1).fill(0);
    const p = Array(m + 1).fill(0);
    const way = Array(m + 1).fill(0);

    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = Array(m + 1).fill(Infinity);
        const used = Array(m + 1).fill(false);

        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = Infinity;
            let j1 = 0;

            for (let j = 1; j <= m; j++) {
                if (!used[j]) {
                    const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if (minv[j] < delta) {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }

            for (let j = 0; j <= m; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }

            j0 = j1;
        } while (p[j0] !== 0);

        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0 !== 0);
    }

    const result = Array(n).fill(-1);
    for (let j = 1; j <= m; j++) {
        if (p[j]) result[p[j] - 1] = j - 1;
    }
    return result;
}

// Costs: rows = vehicles; columns = parking spaces.
const matrix = [
    [1, 2], // Vehicle A
    [2, 100] // Vehicle B
];

const vehicles = ["A", "B"];
const spaces = ["P1", "P2"];

// Greedy: process vehicles in order.
const used = new Set();
let greedyTotal = 0;

vehicles.forEach((vehicle, i) => {
    let best = -1;
    let bestCost = INF;

    spaces.forEach((space, j) => {
        if (!used.has(j) && matrix[i][j] < bestCost) {
            best = j;
            bestCost = matrix[i][j];
        }
    });

    if (best !== -1) {
        used.add(best);
        greedyTotal += bestCost;
        console.log(`Greedy: ${vehicle} -> ${spaces[best]}, cost ${bestCost}`);
    }
});

const chosen = hungarian(matrix);
let hungarianTotal = 0;

chosen.forEach((j, i) => {
    hungarianTotal += matrix[i][j];
    console.log(`Hungarian: ${vehicles[i]} -> ${spaces[j]}, cost ${matrix[i][j]}`);
});

console.log("\nGreedy total cost:", greedyTotal);
console.log("Hungarian total cost:", hungarianTotal);