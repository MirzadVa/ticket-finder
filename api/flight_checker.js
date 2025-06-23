import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sgMail from "@sendgrid/mail";

// Load environment variables (only locally)
if (process.env.NODE_ENV !== "production") {
  const dotenv = await import("dotenv");
  dotenv.config();
}

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const COOKIE = process.env.COOKIE;
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const RECIPIENT_EMAILS = process.env.RECIPIENT_EMAILS.split(",");
const TEMPLATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../template.html"
);
const DATA_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data.json"
);

const headers = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0",
  Origin: "https://www.flypgs.com",
  Referer: "https://www.flypgs.com/",
  Accept: "application/json, text/plain, */*",
};

const data = {
  depPort: "SJJ",
  arrPort: "SAW",
  flightDate: new Date().toISOString().split("T")[0],
  currency: "EUR",
};

const convertToTRY = async (eurAmount) => {
  try {
    const res = await axios.get(
      "https://api.frankfurter.app/latest?from=EUR&to=TRY"
    );
    const rate = res.data.rates.TRY;
    return (eurAmount * rate).toFixed(2);
  } catch (error) {
    console.error("Currency conversion failed:", error.message);
    return null;
  }
};

function groupByMonth(flights) {
  const grouped = {};
  const monthOrder = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  flights.forEach((flight) => {
    const date = new Date(flight.date);
    const month = monthOrder[date.getMonth()];
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(flight);
  });

  // Sort months in correct order
  const ordered = {};
  monthOrder.forEach((m) => {
    if (grouped[m]) ordered[m] = grouped[m];
  });

  return ordered;
}

function loadPreviousData() {
  try {
    const content = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function saveData(flights) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(flights, null, 2), "utf-8");
}

function flightsChanged(newData, oldData) {
  return JSON.stringify(newData) !== JSON.stringify(oldData);
}

function formatHTML(flightsGrouped) {
  let html = "";
  for (const [month, flights] of Object.entries(flightsGrouped)) {
    html += `<h2>🗓️ ${month}</h2><ul>`;
    flights.forEach((f) => {
      const style = f.price < 40 ? "cheapest" : "";
      html += `<li class="${style}">${f.date} &rarr; ${f.price} EUR (${f.priceTRY} TRY) (${f.from} &rarr; ${f.to})</li>`;
    });
    html += `</ul>`;
  }
  return html;
}

async function fetchFlights() {
  try {
    const res = await axios.post(
      "https://www.flypgs.com/apint/cheapfare/flight-calender-prices",
      data,
      { headers }
    );
    const calendar = res.data.cheapFareFlightCalenderModelList;
    if (!calendar || !Array.isArray(calendar))
      throw new Error("Invalid response structure.");

    const allFlights = [];
    for (const month of calendar) {
      const validDays = month.days.filter(
        (d) =>
          d.availFlightMessage !== "NO_FARE" &&
          d.cheapFare.amount > 0 &&
          d.cheapFare.amount <= 45
      );
      for (const day of validDays) {
        const priceTRY = await convertToTRY(day.cheapFare.amount);
        allFlights.push({
          date: day.flightDate,
          price: day.cheapFare.amount,
          priceTRY,
          from: month.depPort,
          to: month.arrPort,
        });
      }
    }

    allFlights.sort((a, b) => a.price - b.price);
    return allFlights;
  } catch (err) {
    console.error("❌ Error:", err.message);
    return [];
  }
}

async function sendEmail(htmlContent) {
  const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const finalHtml = template.replace("{{FLIGHT_CONTENT}}", htmlContent);

  const msg = {
    to: RECIPIENT_EMAILS,
    from: SENDER_EMAIL,
    subject: "Pegasus Flights Under 45 EUR",
    html: finalHtml,
  };

  await sgMail.sendMultiple(msg);
  console.log("📧 Email sent to:", RECIPIENT_EMAILS.join(", "));
}

(async () => {
  const current = await fetchFlights();
  const previous = loadPreviousData();

  const grouped = groupByMonth(current);
  const html = formatHTML(grouped);

  console.log("--- Flights ---");
  console.log(html.replace(/<[^>]*>/g, "")); // log as plain text

  if (flightsChanged(current, previous)) {
    await sendEmail(html);
    saveData(current);
  }
})();
