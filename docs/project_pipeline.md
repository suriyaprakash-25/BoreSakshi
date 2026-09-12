# BoreSakshi: Project Pipeline & Architecture

This document breaks down the step-by-step pipeline of how the **BoreSakshi** platform operates, from the moment a user opens the application to the final generation of a prediction report.

---

## Step 1: Frontend User Interface (React.js)
**What it does:** Serves as the gateway for all users (Farmers, Rig Operators, and Admins). 
**Description:** The application is built using React.js and React Router, creating a seamless Single Page Application (SPA). It uses modern UI principles like glassmorphism and custom Vanilla CSS. When a user lands on the Welcome page, they are presented with clear calls-to-action based on their role: Farmers can access the map, while operators can log in to their dashboard.

## Step 2: Geospatial Interactive Map (React Leaflet)
**What it does:** Provides the visual interface for location selection and historical data viewing.
**Description:** 
- The map relies on open-source OpenStreetMap (OSM) tiles for its background imagery.
- When a farmer clicks on the map, a custom coordinate-capture hook intercepts the exact Latitude and Longitude of the tap.
- The map also fetches and overlays past borewell attempts as color-coded dots (Green = Water, Red = Dry Hole), allowing users to visually inspect neighboring success rates.

## Step 3: API Request Routing (Node.js & Express)
**What it does:** Acts as the traffic controller bridging the frontend map and the backend database/prediction algorithms.
**Description:** Once the farmer selects a point on the map, the frontend dispatches a network request containing the precise coordinates to the Node.js backend. The Express.js server receives this request, handles user authentication if necessary, and forwards the data to the predictive engine.

## Step 4: The Prediction Engine
**What it does:** Analyzes the location data to generate a groundwater probability score.
**Description:** The core engine processes the captured coordinates. It cross-references the location against historical data, geographical factors, and proximity to previously successful/failed wells. It then calculates:
1. **Success Probability** (e.g., 85% chance of finding water).
2. **Estimated Depth** (how deep the rig needs to drill).
3. **Estimated Yield** (Liters Per Minute).

## Step 5: The Accountability Ledger (Database)
**What it does:** Maintains a tamper-proof, public record of drilling outcomes.
**Description:** If the user is a logged-in Rig Operator, they use this phase of the pipeline to submit an outcome report after drilling. This data is permanently logged into the system’s ledger. It serves two purposes:
- It feeds back into the Prediction Engine to make future predictions in that area more accurate.
- It builds a public reputation profile for the operator, forcing transparency and accountability within the industry.

## Step 6: Admin Oversight & Flagging
**What it does:** Ensures the integrity of the data on the platform.
**Description:** The final piece of the pipeline is the Admin Dashboard. Administrators monitor the incoming ledger data. If an operator submits highly suspicious or fake data to artificially boost their success rate, Admins can review the flagged logs and suspend operators, keeping the ecosystem trustworthy for farmers.
