import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";

import L from "leaflet";
import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",

  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",

  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Starting Bengaluru positions
const startingPositions = {
  "BUS-101": [13.1007, 77.5963],
  "BUS-102": [13.0358, 77.5970],
  "BUS-103": [12.9763, 77.5713],
};

// Small movement path for each bus
const busPaths = {
  "BUS-101": [
    [13.1007, 77.5963],
    [13.1025, 77.5990],
    [13.1042, 77.6015],
    [13.1028, 77.6040],
    [13.1005, 77.6018],
  ],

  "BUS-102": [
    [13.0358, 77.5970],
    [13.0380, 77.5995],
    [13.0402, 77.6015],
    [13.0385, 77.6040],
    [13.0360, 77.6015],
  ],

  "BUS-103": [
    [12.9763, 77.5713],
    [12.9780, 77.5740],
    [12.9800, 77.5760],
    [12.9782, 77.5780],
    [12.9758, 77.5750],
  ],
};

// Move map when selected vehicle changes
function MapFocus({ vehicle }) {
  const map = useMap();

  useEffect(() => {
    if (!vehicle) return;

    const position =
      startingPositions[vehicle.id];

    if (!position) return;

    map.flyTo(position, 12, {
      duration: 0.8,
    });
  }, [vehicle, map]);

  return null;
}

// Status colors
function getMarkerColor(status) {
  if (status === "CRITICAL") {
    return "#dc2626";
  }

  if (status === "WARNING") {
    return "#f59e0b";
  }

  return "#16a34a";
}

// Create custom bus marker
function createBusIcon(status) {
  const color = getMarkerColor(status);

  return L.divIcon({
    className: "guardian-bus-marker",

    html: `
      <div
        style="
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: ${color};
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 20px;
        "
      >
        🚌
      </div>
    `,

    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

function FleetMap({
  vehicles,
  selectedVehicle,
  setSelectedVehicle,
}) {
  const [busPositions, setBusPositions] =
    useState(startingPositions);

  const [pathIndexes, setPathIndexes] =
    useState({
      "BUS-101": 0,
      "BUS-102": 0,
      "BUS-103": 0,
    });

  // Move buses every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPathIndexes((current) => {
        const next = {
          ...current,
        };

        Object.keys(busPaths).forEach(
          (busId) => {
            const path = busPaths[busId];

            next[busId] =
              (current[busId] + 1) %
              path.length;
          }
        );

        return next;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Update positions whenever path index changes
  useEffect(() => {
    setBusPositions((current) => {
      const next = {
        ...current,
      };

      Object.keys(busPaths).forEach(
        (busId) => {
          const path = busPaths[busId];

          next[busId] =
            path[pathIndexes[busId]];
        }
      );

      return next;
    });
  }, [pathIndexes]);

  // Move selected vehicle with its marker
  useEffect(() => {
    if (!selectedVehicle) return;

    const position =
      busPositions[selectedVehicle.id];

    if (!position) return;

    // Map will follow the selected bus
  }, [busPositions, selectedVehicle]);

  return (
    <div className="real-fleet-map">

      <MapContainer
        center={[13.02, 77.59]}
        zoom={11}
        scrollWheelZoom={true}
        style={{
          width: "100%",
          height: "100%",
          minHeight: "420px",
        }}
      >

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapFocus
          vehicle={selectedVehicle}
        />

        {vehicles.map((vehicle) => {

          const position =
            busPositions[vehicle.id];

          if (!position) {
            return null;
          }

          return (
            <Marker
              key={vehicle.id}
              position={position}
              icon={createBusIcon(
                vehicle.status
              )}
              eventHandlers={{
                click: () =>
                  setSelectedVehicle(vehicle),
              }}
            >

              <Popup>

                <div
                  style={{
                    minWidth: "170px",
                    fontFamily:
                      "Arial, sans-serif",
                  }}
                >

                  <strong>
                    🚌 {vehicle.id}
                  </strong>

                  <br />

                  <span>
                    Driver: {vehicle.driver}
                  </span>

                  <br />

                  <span>
                    Route: {vehicle.route}
                  </span>

                  <br />

                  <span>
                    Location: {vehicle.location}
                  </span>

                  <br />

                  <strong
                    style={{
                      color:
                        getMarkerColor(
                          vehicle.status
                        ),
                    }}
                  >
                    Risk: {vehicle.risk}%
                  </strong>

                  <br />

                  <strong>
                    Status: {vehicle.status}
                  </strong>

                  <br />

                  <span>
                    🛰️ Live tracking
                  </span>

                </div>

              </Popup>

            </Marker>
          );
        })}

      </MapContainer>

      <div className="map-status-legend">

        <span>
          <i className="legend-dot active"></i>
          ACTIVE
        </span>

        <span>
          <i className="legend-dot warning"></i>
          WARNING
        </span>

        <span>
          <i className="legend-dot critical"></i>
          CRITICAL
        </span>

        <span>
          🛰️ LIVE MOVEMENT
        </span>

      </div>

    </div>
  );
}

export default FleetMap;