const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");

// All routes need auth
router.use(authMiddleware);

// ─── GET /api/attendance/today ────────────────────────────────────
router.get("/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [rows] = await db.query(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [req.user.id, today]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/attendance/checkin ────────────────────────────────
router.post("/checkin", async (req, res) => {
  const { location_type = "office", lat, lng } = req.body;
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toTimeString().split(" ")[0]; // HH:MM:SS

  try {
    // Check already checked in today
    const [existing] = await db.query(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [req.user.id, today]
    );

    if (existing.length > 0 && existing[0].check_in) {
      return res.status(400).json({ success: false, message: "Already checked in today" });
    }

    // Late check - office starts at 09:30
    const officeStart = "09:30:00";
    const isLate = now > officeStart;
    let lateMinutes = 0;
    if (isLate) {
      const startParts = officeStart.split(":").map(Number);
      const nowParts = now.split(":").map(Number);
      lateMinutes = (nowParts[0] * 60 + nowParts[1]) - (startParts[0] * 60 + startParts[1]);
    }

    if (existing.length > 0) {
      await db.query(
        "UPDATE attendance SET check_in = ?, location_type = ?, check_in_lat = ?, check_in_lng = ?, is_late = ?, late_minutes = ?, status = 'present' WHERE employee_id = ? AND date = ?",
        [now, location_type, lat, lng, isLate, lateMinutes, req.user.id, today]
      );
    } else {
      await db.query(
        "INSERT INTO attendance (employee_id, date, check_in, location_type, check_in_lat, check_in_lng, is_late, late_minutes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')",
        [req.user.id, today, now, location_type, lat, lng, isLate, lateMinutes]
      );
    }

    res.json({ success: true, message: "Checked in successfully", check_in: now, is_late: isLate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/attendance/checkout ───────────────────────────────
router.post("/checkout", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toTimeString().split(" ")[0];

  try {
    const [rows] = await db.query(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [req.user.id, today]
    );

    if (rows.length === 0 || !rows[0].check_in) {
      return res.status(400).json({ success: false, message: "Please check in first" });
    }

    if (rows[0].check_out) {
      return res.status(400).json({ success: false, message: "Already checked out today" });
    }

    // Calculate work duration
    const checkIn = rows[0].check_in; // HH:MM:SS
    const inParts = checkIn.split(":").map(Number);
    const outParts = now.split(":").map(Number);
    const durationMinutes =
      (outParts[0] * 60 + outParts[1]) - (inParts[0] * 60 + inParts[1]);

    await db.query(
      "UPDATE attendance SET check_out = ?, work_duration_minutes = ? WHERE employee_id = ? AND date = ?",
      [now, durationMinutes, req.user.id, today]
    );

    res.json({ success: true, message: "Checked out successfully", check_out: now, work_duration_minutes: durationMinutes });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── GET /api/attendance/history?month=4&year=2026 ────────────────
router.get("/history", async (req, res) => {
  const { month, year } = req.query;
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();

  try {
    const [rows] = await db.query(
      `SELECT * FROM attendance 
       WHERE employee_id = ? AND MONTH(date) = ? AND YEAR(date) = ?
       ORDER BY date ASC`,
      [req.user.id, m, y]
    );

    // Summary counts
    const present = rows.filter((r) => r.status === "present").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const holiday = rows.filter((r) => r.status === "holiday").length;
    const late = rows.filter((r) => r.is_late).length;
    const wfh = rows.filter((r) => r.location_type === "wfh").length;
    const extraHoursDays = rows.filter((r) => r.work_duration_minutes > 540).length; // >9hrs

    res.json({
      success: true,
      summary: { present, absent, holiday, late, wfh, total: rows.length, extra_hours_days: extraHoursDays },
      records: rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── GET /api/attendance/stats (Dashboard %) ─────────────────────
router.get("/stats", async (req, res) => {
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  try {
    const [rows] = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(status = 'present') as present,
        SUM(status = 'absent') as absent,
        SUM(status = 'leave') as on_leave,
        SUM(is_late = 1) as late_days,
        SUM(location_type = 'wfh') as wfh_days
       FROM attendance
       WHERE employee_id = ? AND MONTH(date) = ? AND YEAR(date) = ?`,
      [req.user.id, month, year]
    );

    const stats = rows[0];
    const rate = stats.total > 0
      ? Math.round((stats.present / stats.total) * 100)
      : 0;

    res.json({ success: true, stats: { ...stats, attendance_rate: rate } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
