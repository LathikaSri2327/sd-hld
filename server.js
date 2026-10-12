const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'recruitment.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('JOB_SEEKER','RECRUITER')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 recruiter_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 company TEXT NOT NULL,
 location TEXT NOT NULL,
 description TEXT NOT NULL,
 skills TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 job_id INTEGER NOT NULL REFERENCES jobs(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'APPLIED',
 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(job_id, user_id)
);
CREATE TABLE IF NOT EXISTS resumes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 original_name TEXT NOT NULL,
 stored_name TEXT NOT NULL,
 uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 message TEXT NOT NULL,
 is_read INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'recruitment.sid',
  secret: process.env.SESSION_SECRET || 'local-practical-change-this-secret-before-deployment',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));

const jobCache = { value: null, expiresAt: 0 };
const CACHE_MS = 60 * 1000;
function emitEvent(type, payload) {
  // Simple local event-processing demonstration. A production system could publish to Kafka/RabbitMQ.
  if (type === 'APPLICATION_CREATED') {
    db.prepare('INSERT INTO notifications(user_id, message) VALUES (?, ?)')
      .run(payload.recruiterId, `New application received for "${payload.jobTitle}".`);
    db.prepare('INSERT INTO notifications(user_id, message) VALUES (?, ?)')
      .run(payload.applicantId, `Your application for "${payload.jobTitle}" was submitted.`);
  }
  if (type === 'APPLICATION_STATUS_CHANGED') {
    db.prepare('INSERT INTO notifications(user_id, message) VALUES (?, ?)')
      .run(payload.applicantId, `Your application for "${payload.jobTitle}" is now ${payload.status}.`);
  }
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please log in first.' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Please log in first.' });
    if (req.session.user.role !== role) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}
function cleanUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
function errorMessage(err) {
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return 'You have already applied for this job.';
  return 'Something went wrong. Please check your input and try again.';
}

app.post('/api/register', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !['JOB_SEEKER', 'RECRUITER'].includes(role)) {
    return res.status(400).json({ error: 'Name, email, password and a valid role are required.' });
  }
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const hash = await bcrypt.hash(String(password), 10);
    const result = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,?)')
      .run(String(name).trim(), String(email).trim().toLowerCase(), hash, role);
    req.session.user = cleanUser(db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid));
    res.status(201).json({ user: req.session.user });
  } catch (err) {
    res.status(400).json({ error: err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Email is already registered.' : errorMessage(err) });
  }
});
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.user = cleanUser(user);
  res.json({ user: req.session.user });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.get('/api/jobs', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let jobs;
  if (!q && jobCache.value && Date.now() < jobCache.expiresAt) {
    jobs = jobCache.value;
  } else {
    jobs = db.prepare(`SELECT jobs.*, users.name AS recruiter_name FROM jobs JOIN users ON users.id=jobs.recruiter_id ORDER BY jobs.id DESC`).all();
    if (!q) { jobCache.value = jobs; jobCache.expiresAt = Date.now() + CACHE_MS; }
  }
  if (q) jobs = jobs.filter(j => `${j.title} ${j.company} ${j.location} ${j.skills}`.toLowerCase().includes(q));
  res.json({ jobs });
});
app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT jobs.*, users.name AS recruiter_name FROM jobs JOIN users ON users.id=jobs.recruiter_id WHERE jobs.id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job });
});
app.post('/api/jobs', requireRole('RECRUITER'), (req, res) => {
  const { title, company, location, description, skills = '' } = req.body || {};
  if (![title, company, location, description].every(v => String(v || '').trim())) {
    return res.status(400).json({ error: 'Title, company, location and description are required.' });
  }
  const result = db.prepare('INSERT INTO jobs(recruiter_id,title,company,location,description,skills) VALUES (?,?,?,?,?,?)')
    .run(req.session.user.id, String(title).trim(), String(company).trim(), String(location).trim(), String(description).trim(), String(skills).trim());
  jobCache.value = null;
  res.status(201).json({ job: db.prepare('SELECT * FROM jobs WHERE id=?').get(result.lastInsertRowid) });
});
app.post('/api/applications', requireRole('JOB_SEEKER'), (req, res) => {
  const jobId = Number(req.body && req.body.jobId);
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  try {
    const result = db.prepare('INSERT INTO applications(job_id,user_id) VALUES (?,?)').run(jobId, req.session.user.id);
    emitEvent('APPLICATION_CREATED', { recruiterId: job.recruiter_id, applicantId: req.session.user.id, jobTitle: job.title });
    res.status(201).json({ application: db.prepare('SELECT * FROM applications WHERE id=?').get(result.lastInsertRowid) });
  } catch (err) { res.status(409).json({ error: errorMessage(err) }); }
});
app.get('/api/applications/mine', requireRole('JOB_SEEKER'), (req, res) => {
  const applications = db.prepare(`SELECT applications.*, jobs.title AS job_title, jobs.company, jobs.location
    FROM applications JOIN jobs ON jobs.id=applications.job_id
    WHERE applications.user_id=? ORDER BY applications.id DESC`).all(req.session.user.id);
  res.json({ applications });
});
app.get('/api/jobs/:id/applicants', requireRole('RECRUITER'), (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=? AND recruiter_id=?').get(req.params.id, req.session.user.id);
  if (!job) return res.status(404).json({ error: 'Job not found or you do not own this job.' });
  const applicants = db.prepare(`SELECT applications.id, applications.status, applications.applied_at,
    users.name, users.email FROM applications JOIN users ON users.id=applications.user_id
    WHERE applications.job_id=? ORDER BY applications.id DESC`).all(job.id);
  res.json({ job, applicants });
});
app.patch('/api/applications/:id/status', requireRole('RECRUITER'), (req, res) => {
  const status = String(req.body && req.body.status || '');
  if (!['REVIEWING', 'SHORTLISTED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Status must be REVIEWING, SHORTLISTED or REJECTED.' });
  }
  const application = db.prepare(`SELECT applications.*, jobs.title AS job_title, jobs.recruiter_id
    FROM applications JOIN jobs ON jobs.id=applications.job_id WHERE applications.id=?`).get(req.params.id);
  if (!application || application.recruiter_id !== req.session.user.id) return res.status(404).json({ error: 'Application not found.' });
  db.prepare('UPDATE applications SET status=? WHERE id=?').run(status, application.id);
  emitEvent('APPLICATION_STATUS_CHANGED', { applicantId: application.user_id, jobTitle: application.job_title, status });
  res.json({ success: true, status });
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${req.session.user.id}-${Date.now()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || !file.originalname.toLowerCase().endsWith('.pdf')) return cb(new Error('Only PDF resumes are allowed.'));
    cb(null, true);
  }
});
app.post('/api/resumes', requireRole('JOB_SEEKER'), (req, res) => {
  upload.single('resume')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Resume upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF resume to upload.' });
    const result = db.prepare('INSERT INTO resumes(user_id,original_name,stored_name) VALUES (?,?,?)')
      .run(req.session.user.id, path.basename(req.file.originalname), req.file.filename);
    res.status(201).json({ resume: { id: result.lastInsertRowid, originalName: req.file.originalname } });
  });
});
app.get('/api/resumes/mine', requireRole('JOB_SEEKER'), (req, res) => {
  const resumes = db.prepare('SELECT id,original_name,uploaded_at FROM resumes WHERE user_id=? ORDER BY id DESC').all(req.session.user.id);
  res.json({ resumes });
});
app.get('/api/notifications', requireAuth, (req, res) => {
  res.json({ notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC').all(req.session.user.id) });
});
app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
  const result = db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.session.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ success: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Recruitment Platform running at http://localhost:${PORT}`));
