# School X — the trial school

A complete, working school in ten children. Every screen in the portal has real
content behind it, and all three intelligence engines have genuine signal to find.

The **CSVs are the source of truth**. `schoolx.json` is a build artefact — never
hand-edit it, because the next build overwrites it.

```bash
node samples/schoolx/build.js                          # sheets  -> schoolx.json
node server/provision.js import samples/schoolx/schoolx.json
node serve.js                                          # -> http://localhost:5490
```

`build.js` runs the real importer's `validate()` before it writes, so a sheet that
would be refused on import is refused at the desk instead of in front of the school.

## The sheets

| File | What it holds |
|---|---|
| `school.csv` | Identity and calendar, as key/value rows. `yearStart`, `yearWorkingDays` and `minAttendance` drive the 75% forecast. |
| `students.csv` | The roll — 10 children, Std V to XII. |
| `staff.csv` | 13 staff: 9 teachers covering every class on the roll, plus principal, office superintendent, accountant and librarian. |
| `accounts.csv` | 8 sign-ins across all six roles. |
| `attendance.csv` | The register grid: one row per working day, one column per child, `P`/`A`/`L` per cell. 74 working days, 1 June – 29 August 2026. |
| `marks.csv` | 59 marks, mostly Quarterly — which is what the Merit-cum-Means matcher reads. |
| `receipts.csv` | 13 fee receipts, adding up to each child's `feePaid`. |
| `notices.csv` | 5 circulars for the notice board. |

### Two columns you will not find in `students.csv`

`attPresent` and `attTotal` are **derived** by `build.js`, counted from
`attendance.csv`. The scholarship engine reads the aggregate and the attendance
engine reads the day-by-day series; if a clerk could edit one without the other,
the eligibility screen and the risk screen would quietly disagree about the same
child. Add a row to the register to add a working day — the calendar comes from
that date column too.

## What the engines find

Run `node samples/schoolx/build.js` then sign in as `admin` to see all of this.

**Attendance — 5 of 10 children flagged, every finding carrying its evidence:**

| Child | Finding |
|---|---|
| Vignesh Chinnasamy (XI-B) | **Has stopped attending** — absent the last 9 working days. Also drifting: 96% → 58%. Risk 97. |
| Divya Selvam (XII-A) | **Attendance is falling away** — 96% in the first 24 days, 42% in the last 24. Now at 72%, below the public-exam bar. |
| Fathima Beevi (IX-A) | **Absent almost every Friday** — 8 of 11 Fridays, against 3% on other days. |
| Gokul Krishnan (X-A) | **Long unbroken absence earlier in the year** — 8 days from 12 June, since returned. |
| Bharath Sundaram (VII-A) | Irregular scattered absence, 7 separate single days. |

**Scholarships — ₹2,22,000 matched across 10 children, ₹24,000 recoverable.**
The two near-misses are the point of the screen: Divya Selvam qualifies for the
Post-Matric SC/ST scholarship and Puthumai Penn on every criterion *except*
attendance. Bring her back above 75% and ₹24,000 follows.

**Data quality — score 95, seven findings.**

## The deliberate defects

Six records carry faults **on purpose**, at realistic rates, so the data-quality
engine has true faults to find. This mirrors how `server/demo.js` seeds the larger
sample school. **Do not "fix" them** — a clean roll makes that screen look useless,
and no real school has a clean roll.

| Child | Fault | Severity |
|---|---|---|
| SX003 & SX009 | Same EMIS ID on two children | blocker |
| SX010 | No Aadhaar number | blocker |
| SX010 | Phone `98430` is not a valid Indian mobile | blocker |
| SX005 | Std XI with no subject group chosen | blocker |
| SX008 | RTE child carrying a ₹14,000 fee demand | warning |
| SX008 | Family income not recorded | warning |
| SX007 | Address missing | warning |

The importer lets all of these through by design: refusing a school's file because
3% of guardians have no second phone number would mean no school could ever onboard.
Errors refuse an import; these are warnings, and the data-quality engine is what
surfaces them afterwards.

## Sign-ins

| Username | Role | Sees |
|---|---|---|
| `admin` | admin | Everything, including School Data and Users |
| `principal` | principal | Everything except user administration |
| `kavitha` | teacher | Class teacher, X-A |
| `ravichandran` | teacher | Class teacher, XII-A |
| `elangovan` | teacher | Class teacher, XI-A |
| `accounts` | accountant | Fees and the collection register |
| `parentsx001` | parent | Karthik Raja M (SX001) |
| `stusx001` | student | Their own record |

> **The passwords are in `accounts.csv`, which is in git.** They are trial
> credentials for a sample school and nothing else. Rotate every one of them on the
> Users screen before this URL goes to anybody outside the project. Re-importing
> never resets a password that has already been changed — existing usernames are
> left alone.

`parentsx001` and `stusx001` read exactly one child: the server narrows every read
route to the account's `sid`, so the other nine children never reach the browser at
all. `tests/server.test.js` asserts that on each read path separately.

## Using these sheets for a different school

Copy the directory, replace the rows, keep the headers. Nothing in `build.js` is
specific to School X — it reads whatever is in the sheets next to it. One
deployment still serves one school: a second school is a second app, a second
database and a second hostname.
