# Recruitment Platform

A simple local recruitment website for a college HLD practical. It includes user registration/login, job posting/search, applications and history, PDF resume upload, recruiter status updates, and in-app notifications.

## Requirements
- Node.js 18 or newer
- npm

## Run on Windows
1. Extract this ZIP.
2. Open the `recruitment-platform` folder in VS Code.
3. Open Terminal > New Terminal.
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open http://localhost:3000

The SQLite database is created automatically in `data/recruitment.db`. Uploaded resumes are stored in `uploads/`.

## Quick demo
1. Register one account with role **Recruiter**.
2. Log out and register a second account with role **Job Seeker**.
3. Log in as recruiter and create a job.
4. Log in as job seeker, search for the job, and apply.
5. Open My Applications to view application history.
6. Log back in as recruiter and update the applicant's status.
7. Log back in as job seeker and open Notifications.

## API endpoints
All endpoints return JSON except the static frontend and successful resume upload response.
- `POST /api/register` — `{name,email,password,role}`
- `POST /api/login` — `{email,password}`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/jobs?q=...`
- `GET /api/jobs/:id`
- `POST /api/jobs` — recruiter only, `{title,company,location,description,skills}`
- `POST /api/applications` — job seeker only, `{jobId}`
- `GET /api/applications/mine`
- `GET /api/jobs/:id/applicants` — owner recruiter only
- `PATCH /api/applications/:id/status` — `{status}`
- `POST /api/resumes` — multipart field `resume`, PDF only
- `GET /api/resumes/mine`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`

## HLD features represented
- REST API: Express JSON endpoints.
- Database: SQLite with foreign keys and a unique user/job application constraint.
- Caching: short-lived in-memory cache for job listings, cleared when a job is created.
- Messaging: a simple event handler writes application/status notifications to the database. This is a local demonstration, not a distributed message broker.
- Scalability: README explains how Redis, Elasticsearch, Kafka/RabbitMQ, PostgreSQL and multiple service instances could be added in production.

## Security notes
Passwords are hashed. Session cookies are HTTP-only. Users can access only their own applications/resumes/notifications and recruiters can manage applicants only for their own jobs. This is a learning project; review security settings before production deployment.
