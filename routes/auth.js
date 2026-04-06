const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const authMiddleware = require("../middleware/auth");

// ─── POST /api/auth/login ─────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password required" });
  }

  try {
    const [rows] = await db.query(
      `SELECT e.*, d.name as department_name 
       FROM employees e 
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.email = ? AND e.is_active = 1`,
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const employee = rows[0];
    const passwordMatch = await bcrypt.compare(password, employee.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: employee.id,
        email: employee.email,
        role: employee.role,
        name: employee.full_name,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: employee.id,
        emp_code: employee.emp_code,
        full_name: employee.full_name,
        email: employee.email,
        phone: employee.phone,
        designation: employee.designation,
        department: employee.department_name,
        department_id: employee.department_id,
        role: employee.role,           // "employee" | "team_lead" | "hr" | "admin"
        experience_years: employee.experience_years,
        blood_group: employee.blood_group,
        profile_photo: employee.profile_photo,
        reporting_to: employee.reporting_to,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/auth/register (HR/Admin use பண்ணும்) ──────────────
router.post("/register", async (req, res) => {
  const {
    emp_code, full_name, email, password,
    phone, designation, department_id,
    role = "employee", reporting_to,
    experience_years = 0, blood_group,
    emergency_contact,
  } = req.body;

  if (!emp_code || !full_name || !email || !password) {
    return res.status(400).json({ success: false, message: "Required fields missing" });
  }

  try {
    const [existing] = await db.query("SELECT id FROM employees WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: "Email already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO employees 
        (emp_code, full_name, email, password_hash, phone, emergency_contact,
         blood_group, designation, department_id, role, reporting_to, experience_years)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp_code, full_name, email.toLowerCase(), password_hash, phone,
       emergency_contact, blood_group, designation, department_id,
       role, reporting_to || null, experience_years]
    );

    // Create leave balance for new employee (current year)
    const year = new Date().getFullYear();
    const [leaveTypes] = await db.query("SELECT * FROM leave_types");
    for (const lt of leaveTypes) {
      await db.query(
        `INSERT INTO leave_balance (employee_id, leave_type_id, year, total_days, used_days)
         VALUES (?, ?, ?, ?, 0)`,
        [result.insertId, lt.id, year, lt.total_days]
      );
    }

    res.status(201).json({ success: true, message: "Employee registered", id: result.insertId });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── GET /api/auth/me (token verify + profile) ───────────────────
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, d.name as department_name
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.id = ?`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const emp = rows[0];
    delete emp.password_hash;

    res.json({ success: true, user: emp });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
