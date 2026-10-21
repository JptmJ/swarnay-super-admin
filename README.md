# Swarnay — Platform Admin

The super admin console. Creates tenants, their head user, branches and module
licences, sets feature flags, and makes demo businesses.
Nobody but a platform operator can sign in here.

```bash
npm install
cp .env.example .env   # once — then set the values for this machine
npm run dev            # http://localhost:4100
npm run build && npm run start   # production (what the Docker image runs)
```

Two env files: `.env` (this machine's values, never in git) and `.env.example`
(the template). On a laptop `BACKEND_URL=http://localhost:4000` (or
`https://api.swarnay.com` to work against the live backend); on the server
`https://api.swarnay.com`. On the server: `cp .env.example .env`, then
`docker compose up -d --build`.

`NEXT_PUBLIC_APP_URL` is where the shop app is served — the Support tab builds
its "open the shop" link from it, and `next build` bakes it in, so rebuild after
changing it. The backend URL is read on the server only; the browser never calls
the backend directly, so no CORS setup is needed. In production the sign-in
cookie is `Secure`, so the panel must be served over HTTPS.

## First sign-in

Create the first operator from the backend — the API has no endpoint that
creates one, so it is made on the command line:

```bash
cd ../swarnay-backend
npm run seed:superadmin -- --password='...'
```

Defaults to `s.admin@swarnay.com`; pass `--email=` to change it. Running it
again resets the password, which is the recovery path if it is lost.

## Roles

**One operator — you — holding everything.** There is a single platform role,
`super_admin`, with `*`. No tiers, no second operator, and no endpoint that
creates one.

A platform token is refused by every tenant endpoint and a tenant token by every
platform endpoint, so this console has no way into a business's data at all.

### Inside a jewellery business

Three kinds, in `swarnay-backend/src/modules/platform/roles.ts`:

| Kind | What it is |
|---|---|
| **Owner** | The proprietor. Everything, every branch. Seeded with the business. |
| **Branch Admin** | Runs a branch, including the shop's own branch list and switching a staff account off. Seeded with the business. |
| **Staff** | Everyone else — **named and given permissions per business**, from that tenant's Roles tab. |

Owner and Branch Admin are fixed: narrowing an owner would lock a shop out of
its own books, and an admin that cannot run a branch is not an admin.

**Staff roles are the point.** One shop's "Accountant" handles billing; another's
handles billing and tagging. Rather than guess a ladder, you name the role as
that shop thinks of it and tick exactly what it reaches — module, area within
it, or single actions. The picker is generated from the live routes, so a tick
always grants something real and the screen cannot drift from the API.

Ticking a whole module grants its wildcard (`pos.*`) rather than every leaf, so
a role given "all of Billing" still means that when billing endpoints are added.

### What a business may do about its own people

Almost nothing, and deliberately. The endpoints are gone rather than
permission-gated: no `POST /api/settings/users`, no role editor, no password
reset. A shop sees its staff list and can **switch an account off** — the one
exception, so somebody leaving at short notice does not wait on us. The owner's
account and one's own are refused.

Everything else is here: add staff, edit name and contact, move branch, change
role, activate, deactivate, issue a temporary password, and define the roles
themselves.

**A branch has exactly one admin.** Either every branch has its own, or one
admin covers all of them; both shapes work and can be mixed. Moving someone into
a branch that already has an admin is refused, naming whoever holds the slot.

## Branches and the branch limit

A branch is created the same way wherever it comes from — this console or the
shop's own Masters → Shops & Branches — through one service, so it always
arrives with the stock locations its kind needs. (They used to differ: a branch
added from inside the shop got no locations at all, and its first sale would
have failed.)

**Branch limit** is set per tenant, on the create form and under Settings. Blank
means no limit, which is where every business starts. It is checked on both
paths, so a shop whose admin may add branches cannot add thirty, and it counts
deactivated branches too — otherwise a branch could be parked to reclaim a slot.

## Switching modules off

Each tenant's **Modules** tab has a switch per module. Switching one off:

- takes it out of the shop's menu (the app reads its module list from the
  session, and re-reads it the moment a call is refused), and
- makes the API refuse **every endpoint of that module** with 403
  `module_disabled` — for every one of the shop's staff.
  Hiding a menu item alone would leave the endpoints answering anyone who knew
  the URL.

Nothing is deleted. Switching it back on restores the module exactly as it was.
Other instances of the backend pick the change up within a minute.

**Master Data, Settings and SaaS Admin are always on.** Every other module reads
rates, items, customers and numbering from them, so the API refuses to switch
them off (`module_required`).

**Sub-modules** can be switched off one at a time where they have permissions
of their own — Purchase and Customer Return under POS, Stock Transfer, Melt
Batches, the three Swarna Nidhi areas and the three ledgers. The rest are shown
greyed: they follow their module until they get permissions of their own.

The create form offers **Switched off** per module too, so a business can start
without one. Every switch is in the audit log as `module.enable` /
`module.disable`.

## Pages

| Route | What it does |
|---|---|
| `/login` | Sign in. |
| `/` | Platform counts and the most recent tenants. |
| `/tenants` | Every tenant, with filters. |
| `/tenants/new` | Create a tenant + its admin + first branch + licences, in one form. |
| `/tenants/demo` | **Demo accounts**: give a count, get that many demo businesses full of sample data, with their logins. |
| `/tenants/[id]` | Staff, **roles**, branches, module licences and **on/off switches**, account status, and deleting a demo. |
| `/flags` | Feature flags: the global default and any per-tenant override. |
| `/roles` | The role kinds and everything a staff role can be given, read-only. Build them per tenant. |
| `/audit` | Every super-admin action, filterable by business and action. |

## Demo accounts

**+ Demo accounts** (Overview and Tenants) asks for one number — how many — and
makes that many complete businesses for showing the product. Each is built
through the same services as a real one, so its books balance and every screen
has something real on it:

- a shop in one Indian city with 1–3 branches, an owner, and a branch admin per
  branch (now and then one admin covering all of them);
- 2–4 **staff roles** (Cashier, Storekeeper, Accountant…) each given a random
  set of permissions from the live permission tree, and 1–2 staff per branch;
- masters — rates with history back to the start of the financial year, items,
  making/wastage/hallmark formulas, customers, suppliers, karigars, two savings
  plans;
- activity in every module — purchases with bills, tagged stock, bills and
  receipts, an approval memo, orders moved along their stages, old gold,
  scheme members with their collections, girvi loans, expenses and a supplier
  payment.

Codes are `demo-xxxxx`, logins are `owner@<code>.test`, `admin.<branch>@<code>.test`
and `first.last@<code>.test`, and **every login in a demo shares one password**.
Nobody is asked to change it at first sign-in.

Demos are made one at a time in the background, a few seconds to a couple of
minutes each; the page shows progress and can be left and come back to. The
passwords are shown there once and kept for an hour — copy them or download the
CSV. **Stop after this one** finishes the demo in hand and starts no more.

A demo is marked `is_demo`, shown with a **Demo** badge and filterable on the
Tenants list. Only a demo can be deleted (Settings tab → *Delete demo account*,
confirmed by typing its code); a real business is refused with `tenant_not_demo`.

The jobs live in the API process's memory, so a restart forgets them — and a
demo being made at that moment is left half-made; delete it from its tenant page.
`npm run db:seed -- --count=N` in the backend makes demos with the same generator.

## Support sessions — removed

Taken out of the console on 2026-10-10: no Support tab, no Support Sessions
page, and nothing here opens a window into a business. The backend endpoints
(`/api/platform/support-sessions`) and the tenant app's support banner still
exist, unused.

## How auth works here

The platform token is kept in an **httpOnly cookie** and never reaches client
JavaScript. The browser calls this app's own `/api/proxy/*` routes, which attach
the token server-side and forward to the backend. Two consequences worth knowing:

- An XSS bug in this panel cannot steal the token.
- The proxy only forwards to `/api/platform/*`. Without that restriction this
  panel would be a general-purpose way to call any backend endpoint as a super
  admin, which is not what it is for.

A 401 triggers one transparent refresh and retry, so a 15-minute access token
does not interrupt someone mid-form.

## Not here yet

Deliberately deferred, not forgotten:

- **Platform billing** — plans, tenant invoices, collection.
- **2FA** for the Super Admin.
- **Support tickets** and **tenant health dashboards**.
