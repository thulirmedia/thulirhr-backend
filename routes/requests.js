const express = require("express");
const router = express.Router();
const db = require("../db");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

// ─── GET /api/requests/my ─────────────────────────────────────────
router.get("/my", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, lt.name as leave_type_name, lt.color as leave_color,
              tl.full_name as tl_name, hr.full_name as hr_name
       FROM requests r
       LEFT JOIN leave_types lt ON r.leave_type_id = lt.id
       LEFT JOIN employees tl ON r.tl_id = tl.id
       LEFT JOIN employees hr ON r.hr_id = hr.id
       WHERE r.employee_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── GET /api/requests/team (TL only - pending approvals) ─────────
router.get("/team", async (req, res) => {
  // Only team_lead, hr, admin can see this
  if (!["team_lead", "hr", "admin"].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  try {
    let query, params;

    if (req.user.role === "team_lead") {
      // TL sees requests from their team members
      query = `
        SELECT r.*, lt.name as leave_type_name,
               e.full_name as employee_name, e.emp_code, d.name as department_name
        FROM requests r
        JOIN employees e ON r.employee_id = e.id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN leave_types lt ON r.leave_type_id = lt.id
        WHERE e.reporting_to = ? AND r.tl_status = 'pending'
        ORDER BY r.created_at DESC`;
      params = [req.user.id];
    } else {
      // HR/Admin sees all TL-approved requests pending HR approval
      query = `
        SELECT r.*, lt.name as leave_type_name,
               e.full_name as employee_name, e.emp_code, d.name as department_name
        FROM requests r
        JOIN employees e ON r.employee_id = e.id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN leave_types lt ON r.leave_type_id = lt.id
        WHERE r.tl_status = 'approved' AND r.hr_status = 'pending'
        ORDER BY r.created_at DESC`;
      params = [];
    }

    const [rows] = await db.query(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/requests/new ───────────────────────────────────────
router.post("/new", async (req, res) => {
  const {
    request_type, leave_type_id, from_date, to_date,
    permission_type, permission_date, from_time, to_time,
    duration_minutes, reason,
  } = req.body;

  if (!request_type || !reason) {
    return res.status(400).json({ success: false, message: "Request type and reason required" });
  }

  try {
    // Get employee's TL
    const [empRows] = await db.query(
      "SELECT reporting_to, department_id FROM employees WHERE id = ?",
      [req.user.id]
    );
    const emp = empRows[0];

    const [result] = await db.query(
      `INSERT INTO requests 
        (employee_id, request_type, leave_type_id, from_date, to_date,
         permission_type, permission_date, from_time, to_time,
         duration_minutes, reason, department_id, tl_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, request_type, leave_type_id || null,
        from_date || null, to_date || null,
        permission_type || null, permission_date || null,
        from_time || null, to_time || null,
        duration_minutes || null, reason,
        emp.department_id, emp.reporting_to || null,
      ]
    );

    res.status(201).json({ success: true, message: "Request submitted", id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/requests/:id/approve ──────────────────────────────
router.post("/:id/approve", async (req, res) => {
  const { id } = req.params;
  const role = req.user.role;

  if (!["team_lead", "hr", "admin"].includes(role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  try {
    const [rows] = await db.query("SELECT * FROM requests WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: "Request not found" });

    const request = rows[0];

    if (role === "team_lead") {
      await db.query(
        "UPDATE requests SET tl_status = 'approved', tl_id = ?, tl_approved_at = NOW() WHERE id = ?",
        [req.user.id, id]
      );
    } else {
      // HR final approval
      await db.query(
        "UPDATE requests SET hr_status = 'approved', hr_id = ?, hr_approved_at = NOW(), final_status = 'approved' WHERE id = ?",
        [req.user.id, id]
      );

      // If leave approved → update leave balance
      if (request.request_type === "leave" && request.leave_type_id) {
        const from = new Date(request.from_date);
        const to = new Date(request.to_date);
        const days = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
        const year = from.getFullYear();

        await db.query(
          `UPDATE leave_balance SET used_days = used_days + ?
           WHERE employee_id = ? AND leave_type_id = ? AND year = ?`,
          [days, request.employee_id, request.leave_type_id, year]
        );
      }
    }

    res.json({ success: true, message: "Request approved" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/requests/:id/reject ───────────────────────────────
router.post("/:id/reject", async (req, res) => {
  const { id } = req.params;
  const role = req.user.role;

  if (!["team_lead", "hr", "admin"].includes(role)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  try {
    if (role === "team_lead") {
      await db.query(
        "UPDATE requests SET tl_status = 'rejected', tl_id = ?, final_status = 'rejected' WHERE id = ?",
        [req.user.id, id]
      );
    } else {
      await db.query(
        "UPDATE requests SET hr_status = 'rejected', hr_id = ?, final_status = 'rejected' WHERE id = ?",
        [req.user.id, id]
      );
    }
    res.json({ success: true, message: "Request rejected" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── GET /api/requests/leave-balance ─────────────────────────────
router.get("/leave-balance", async (req, res) => {
  const year = new Date().getFullYear();
  try {
    const [rows] = await db.query(
      `SELECT lb.*, lt.name, lt.color
       FROM leave_balance lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       WHERE lb.employee_id = ? AND lb.year = ?`,
      [req.user.id, year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
