const axios = require("axios");
const sgMail = require("@sendgrid/mail");
require("dotenv").config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FLIGHT_API_URL =
  "https://www.flypgs.com/apint/cheapfare/flight-calender-prices";
const EXCHANGE_API = "https://api.frankfurter.app/latest?from=EUR&to=TRY";

module.exports = async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const headers = {
      "Content-Type": "application/json",
      Cookie: process.env.COOKIE,
      "User-Agent": "Mozilla/5.0",
      Origin: "https://www.flypgs.com",
      Referer: "https://www.flypgs.com/",
      Accept: "application/json, text/plain, */*",
    };

    const body = {
      depPort: "SJJ",
      arrPort: "SAW",
      flightDate: today,
      currency: "EUR",
    };

    const [flightRes, exchangeRes] = await Promise.all([
      axios.post(FLIGHT_API_URL, body, { headers }),
      axios.get(EXCHANGE_API),
    ]);

    const rate = exchangeRes.data.rates.TRY || 30;
    const data = flightRes.data;

    if (!data.cheapFareFlightCalenderModelList) {
      console.log("No valid flight data found.");
      return res.status(200).send("No flight data available.");
    }

    const flights = [];

    for (const month of data.cheapFareFlightCalenderModelList) {
      const validDays = month.days.filter(
        (d) => d.availFlightMessage !== "NO_FARE" && d.cheapFare.amount > 0
      );

      for (const day of validDays) {
        const price = parseFloat(day.cheapFare.amount.toFixed(2));
        if (price <= 45) {
          flights.push({
            date: day.flightDate,
            price,
            priceInTry: (price * rate).toFixed(2),
            currency: day.cheapFare.currency,
            from: month.depPort,
            to: month.arrPort,
          });
        }
      }
    }

    if (flights.length === 0) {
      console.log("No cheap flights found.");
      return res.status(200).send("No cheap flights under 45 EUR found.");
    }

    // Group by month name
    const grouped = {};
    for (const f of flights) {
      const monthName = new Date(f.date).toLocaleString("en-US", {
        month: "long",
      });
      if (!grouped[monthName]) grouped[monthName] = [];
      grouped[monthName].push(f);
    }

    const monthOrder = {
      January: 1,
      February: 2,
      March: 3,
      April: 4,
      May: 5,
      June: 6,
      July: 7,
      August: 8,
      September: 9,
      October: 10,
      November: 11,
      December: 12,
    };

    const sortedMonthNames = Object.keys(grouped).sort(
      (a, b) => monthOrder[a] - monthOrder[b]
    );

    let html = "";
    for (const month of sortedMonthNames) {
      const flights = grouped[month];
      html += `<h2>📅 ${month}</h2><ul>`;
      flights.forEach((flight) => {
        const isCheapest = flight.price < 40;
        const liClass = isCheapest ? ' class="cheapest"' : "";
        html += `<li${liClass}>${flight.date} → ${flight.price} EUR (${flight.priceInTry} TRY) (${flight.from} → ${flight.to})</li>`;
      });
      html += "</ul>";
    }

    const fs = require("fs");
    const template = fs.readFileSync("./template.html", "utf8");
    const htmlBody = template.replace("{{FLIGHT_CONTENT}}", html);

    const msg = {
      to: process.env.RECIPIENT_EMAILS.split(","),
      from: process.env.SENDER_EMAIL,
      subject: "🛫 Cheap Pegasus Flights Under 45 EUR",
      html: htmlBody,
    };

    await sgMail.send(msg);
    console.log("✅ Email sent");
    res.status(200).send("Email sent successfully");
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Internal Server Error");
  }
};
