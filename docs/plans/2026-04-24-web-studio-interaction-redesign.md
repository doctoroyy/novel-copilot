# Web Studio Interaction Redesign

Date: 2026-04-24
Branch: `ux-interaction-redesign`

## Direction

Novel Copilot is a long-form production tool, not a marketing site. The interface should feel like a professional writing studio: dense enough for daily work, calm enough for long sessions, and explicit about the next best action.

Visual language: editorial operations desk. Use restrained surfaces, strong information hierarchy, compact controls, chapter timelines, status chips, and persistent progress context.

## Draft 01: Project Cockpit

```
+-----------------------------------------------------------------------+
| Project title / state                         Primary next action     |
+---------------------------+------------------+------------------------+
| Completion ring           | Current chapter  | Production health      |
|  37%                      | Next: 149        | Outline / Words / QC   |
+---------------------------+------------------+------------------------+
| Next best action strip                                                |
| [Generate outline] [Generate next chapter] [Open chapter list]        |
+-----------------------------------------------------------------------+
| Volume timeline                                                       |
| V1 -------- V2 -------- V3 -------- V4                                |
+-----------------------------------------------------------------------+
| Story objective / open loops / human attention                         |
+-----------------------------------------------------------------------+
```

Goal: remove card sprawl and turn the dashboard into a decision page. The first viewport answers: where are we, what is blocking us, what should I do next?

## Draft 02: Generation Runway

```
+-----------------------------------------------------------------------+
| Runway header: stage, remaining chapters, current task                 |
+-----------------------------+-----------------------------------------+
| Stage rail                  | Current action panel                    |
| 1 Outline                   | Inputs / generate button / cancel       |
| 2 Context                   |                                         |
| 3 Draft                     | Progress and forecast                   |
| 4 QC                        |                                         |
| 5 Memory                    |                                         |
+-----------------------------+-----------------------------------------+
| Flow map with active stage and loopback                                |
+-----------------------------------------------------------------------+
```

Goal: make generation feel like a supervised pipeline instead of two disconnected forms.

## Draft 03: Chapter Production Board

```
+-----------------------------------------------------------------------+
| Chapters: count / next index / remaining       New | Generate | Batch  |
+-----------------------+-----------------------------------------------+
| Volume navigator       | Chapter rows                                  |
| V1  1-80  60 done      | 001 Title     Copy Rewrite Delete Open        |
| V2  81-160 0 done      | 002 Title     Copy Rewrite Delete Open        |
+-----------------------+-----------------------------------------------+
```

Goal: shift from a plain list to a production board that supports scanning by volume, creating, regenerating, copying, and deletion without losing context.

## Draft 04: Focus Editor

```
+-----------------------------------------------------------------------+
| Back | Chapter title | word count | save state       AI | QC | Save    |
+-----------------------------------------------------------------------+
|                         Manuscript page                                |
|                selected text => floating AI revise control             |
|                                                                       |
+---------------------------------------------+-------------------------+
|                                             | optional chapter chat    |
+---------------------------------------------+-------------------------+
```

Goal: keep the editor quiet and manuscript-first, while exposing AI and consistency tools as nearby utilities.

## Draft 05: QC Triage

```
+-----------------------------------------------------------------------+
| Score ring | critical / major / minor counts        Scan mode / action |
+-----------------------------------------------------------------------+
| Global analysis: pacing, character arc, plot threads, conflict         |
+-----------------------------------------------------------------------+
| Chapter issue queue: severity filter, fix all, expand per chapter      |
+-----------------------------------------------------------------------+
```

Goal: make QC an issue queue, not just a report.

## Draft 06: Copilot Command Center

```
+-----------------------------------------------------------------------+
| Session list | active turn timeline | proposal / result confirmation   |
+-----------------------------------------------------------------------+
```

Goal: Copilot should feel like an operator sidecar that works on project state, with clear turns, traces, and confirmations.

## Implemented Scope

This branch implements the first three drafts in the Web app:

- Project cockpit: `DashboardView`
- Generation runway: `GenerateView`
- Chapter production board: `ChapterListView`
- QC triage desk: `QualityView`

The editor and Copilot drafts are kept as follow-up design targets because their current files have more behavioral surface.
