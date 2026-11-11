# Simulation simmwcl1g3p — 31/31 checks passed

n=203, seed=20261111, 358s, 4626 API calls (26 rate-limited, retried)

| Area | Check | Result |
|---|---|---|
| accounts | all 203 accounts have the expected lifecycle status | PASS |
| accounts | won opportunities promote prospects/churned accounts to customer | PASS |
| accounts | churned accounts carry churn date + reason | PASS |
| accounts | account list filter by lifecycle status works | PASS |
| contacts | campaign memberships match plan (0 … 5 per contact) | PASS |
| contacts | some contacts have zero campaigns, others several | PASS |
| opportunities | every opportunity reached its target stage | PASS |
| opportunities | pipeline spans pre-qualified through negotiation + closed | PASS |
| opportunities | stage history records the full path for every deal | PASS |
| opportunities | main POC is exactly the planned contact (≤1 per opp) | PASS |
| opportunities | mix: champion is POC / champion ≠ POC / POC only / none | PASS |
| opportunities | deals at proposal+ have a synced quote; approvals completed | PASS |
| accounts | account champion resolved correctly for 65 accounts | PASS |
| leads | all 203 leads received, worked and converted | PASS |
| leads | no open leads left from this run | PASS |
| leads | existing-contact leads merged into that contact (no duplicate person) | PASS |
| leads | exactly one person per existing-contact email after conversion | PASS |
| leads | existing-account leads attached to the matched account (no new account) | PASS |
| leads | net-new leads created new prospect accounts | PASS |
| leads | conversions created opportunities exactly where planned | PASS |
| leads | unqualified leads cannot convert until re-qualified | PASS |
| leads | every lead was routed by assignment rules on receipt | PASS |
| leads | EMEA leads routed to the EMEA AE | PASS |
| leads | inbound leads round-robined evenly across the SDR pod | PASS |
| leads | matched leads handed off to the account owner before conversion | PASS |
| automation | speed-to-lead task workflow ran once per routed lead | PASS |
| automation | negotiation workflow ran once per deal entering negotiation | PASS |
| automation | churn alert fired once per churn (and not for other account edits) | PASS |
| security | reps can't open peers' opportunities; their manager can | PASS |
| reports | lead-conversion report counts exactly this run's conversions (fresh tenant) | PASS |
| reports | pipeline report = every open opportunity (seeded + created at conversion) | PASS |

## Distributions

```json
{
  "summary": {
    "accStatus": {
      "prospect": 97,
      "churned": 29,
      "customer": 77
    },
    "campaignDist": {
      "0": 72,
      "1": 61,
      "2": 40,
      "3": 16,
      "4": 8,
      "5": 6
    },
    "stageCounts": {
      "lead": 37,
      "proposal": 30,
      "negotiation": 34,
      "qualified": 31,
      "discovery": 31,
      "closed_lost": 16,
      "closed_won": 24
    },
    "withChampion": 72,
    "champIsPoc": 61,
    "pocNotChamp": 48
  },
  "leads": {
    "byKind": {
      "existingContact": 45,
      "existingAccount": 70,
      "netNew": 88
    },
    "bySource": {
      "content": 22,
      "web": 52,
      "outbound": 22,
      "list_import": 23,
      "referral": 27,
      "event": 25,
      "webinar": 32
    },
    "byPath": {
      "disqualifiedThenRequalified": 21,
      "nurtureFirst": 48,
      "direct": 134
    },
    "receivedVia": {
      "api": 151,
      "web_form": 52
    },
    "routedTo": {
      "sdr1": 21,
      "sdr2": 20,
      "ae3": 12,
      "ae6": 62,
      "sdr4": 20,
      "sdr3": 20,
      "ae1": 12,
      "ae5": 12,
      "ae4": 12,
      "ae2": 12
    },
    "withOpportunity": 93
  },
  "deals": {
    "byKind": {
      "new_business": 123,
      "expansion": 56,
      "win_back": 24
    },
    "quoted": 97,
    "approvals": 27
  }
}
```