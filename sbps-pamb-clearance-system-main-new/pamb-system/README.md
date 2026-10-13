# SBPS PAMB Clearance / SAPA Application System

Web application version of the **Requirements for PAMB Clearance/SAPA Application** checklist and the **Annex A Application Form** for the Sarangani Bay Protected Seascape (PAMO, DENR Region 12).

- **Applicants** register, fill in Annex A, upload each requirement, submit, and track the review.
- **PAMO administrators** see a dashboard, review every file, accept or send back each requirement, and move the application through PAMB clearance, ECC and SAPA approval.

## Run it

Needs **Node.js 22.13 or newer**. There is nothing to install: the app uses only Node's built-in modules, including its built-in SQLite.

```
cd pamb-system
npm start
```

Open http://localhost:3000.

On the first run the app creates an administrator and prints the login once:

```
Email:    admin@sbps.local
Password: <generated>
```

You are asked to change that password right after you log in. To choose your own, start with:

```
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase-1' npm start
```

Run the automated checks with `npm test` (37 checks covering the whole workflow).

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `DATA_DIR` | `./data` | Where the database (`pamb.db`) and uploaded files live |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@sbps.local`, generated | First administrator, used only if no admin exists yet |
| `COOKIE_SECURE` | off | Set to `1` when served over HTTPS |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so rate limits use the real client IP |

## How an application moves

1. **Draft.** The applicant fills in Annex A and uploads the 14 requirements. Work is saved automatically.
2. **Submitted.** The system assigns `SBPS-YYYY-NNNN`, stamps the date filed, and locks editing.
3. **Under review.** The admin opens each file and marks it *Accepted* or *Needs revision* with a remark.
4. **Returned for revision** (optional). The applicant fixes the flagged items and resubmits. The application number stays the same.
5. **PAMB cleared.** The ECC upload opens for the applicant.
6. **ECC submitted**, then **SAPA approved** (the admin enters the expiry date). An admin can also reject, or ask for a new ECC.

Every step is recorded in a history timeline that both sides can see.

## What is on each screen

- **Login and registration** with a depth-contour illustration of the bay.
- **Applicant:** application list, Annex A form (new or renewal, type of applicant, nine special uses, description), requirement checklist with uploads, progress, history, and the PAMO contact (Krizelle C. Pangcatan).
- **Admin dashboard:** items waiting for review, counts by stage, pipeline bar, special uses applied for, filings per month, recent activity.
- **Admin applications:** search plus filters for status, applicant type and special use, and a CSV export.
- **Admin review:** decision panel, per-requirement review, full Annex A details, applicant account.
- **Admin users:** promote or demote administrators, deactivate or reactivate accounts.

## Security built in

Passwords are hashed with scrypt. Sessions use HttpOnly, SameSite cookies, and every write needs a CSRF token. Failed logins and registrations are rate limited. Applicants can only see their own applications and files. Uploads are limited to PDF, JPG, PNG, DOC and DOCX up to 10 MB, checked by file signature, stored under random names outside the web root, and served only to authorised users as downloads. The CSV export neutralises spreadsheet formulas. A strict Content-Security-Policy and other security headers are set.

## Going live

- Put it behind HTTPS (for example nginx or Caddy) and set `COOKIE_SECURE=1` and `TRUST_PROXY=1`.
- Back up the whole `DATA_DIR` folder (database and uploads) regularly.
- The page loads two Google Fonts. Without internet access it falls back to the system font and still works.

## Known limits

- No email or SMS notifications yet. Applicants see status changes when they log in.
- One server only (SQLite and in-memory rate limiting).
- There is no "forgot password" flow. An administrator can deactivate an account, but resetting a password needs a small addition.
- Node marks its built-in SQLite as experimental. `npm start` hides the warning.

## Customising the checklist

Requirements, special uses, applicant types and statuses are plain lists at the top of `server.js`. The scanned checklist had one line that was blacked out between *Zoning Clearance* and *Comprehensive Development and Management Plan*. It is not included. If that line was a real requirement, add one entry to `REQUIREMENTS`.
