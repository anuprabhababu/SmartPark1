SMARTPARK - COMPLETE CORRECTED PROJECT

Included:
- HTML/CSS/JavaScript frontend
- Node.js + Express backend
- Greedy and Hungarian allocation algorithms
- MongoDB persistence (vehicles, parking spaces, allocation history)
- Graphs remain empty on initial dashboard load and when adding/departing vehicles.
  Click Compare Algorithms to preview live results. Run allocation to commit assignments.

HOW TO RUN (Windows / VS Code)
1. Extract this ZIP.
2. Open the aad folder in VS Code (the folder containing package.json).
3. Make sure MongoDB Server is running.
4. Create a file named .env in the aad folder (same folder as package.json).
5. Put these lines in .env:
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017/SmartPark
   If your MongoDB database uses a different exact capitalization, use that existing name.
6. Open Terminal in VS Code and run:
   npm install
   npm start
7. Open http://localhost:3000

MongoDB Compass is optional. Connect to mongodb://127.0.0.1:27017 and refresh after adding a vehicle.
Do not put your real .env file or database passwords into a public repository.
