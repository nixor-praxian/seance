# Alfred workflow for seance

An Alfred 5.5+ workflow that fronts the `seance` CLI. Type `s ` in Alfred; results come from `seance json query "<q>"` (Script Filter JSON), and actioning a result runs `seance <arg>` (e.g. `seance organize`, `seance focus zephyr`).

## Install

**Via the CLI:**

```bash
seance alfred install
```

Copies `alfred/seance-workflow` into Alfred's workflows directory, rewrites the baked-in `PATH` to include the node install running the command (Alfred runs scripts under a sterile environment), and reloads the workflow. Re-run it after `npm run build`.

**Manually:**

Copy the folder into Alfred's workflows directory and reload Alfred:

```bash
cp -R alfred/seance-workflow "$HOME/Library/Application Support/Alfred/Alfred.alfredpreferences/workflows/seance-workflow"
```

(If Alfred syncs its preferences to a custom folder, use `<syncfolder>/Alfred.alfredpreferences/workflows` instead — check `defaults read com.runningwithcrayons.Alfred-Preferences syncfolder`.) Then open Alfred Preferences → Workflows, or restart Alfred, to pick it up. Patch the two `export PATH=` lines yourself if `seance` isn't on Alfred's default `PATH`.

## Object graph

```
Script Filter "s"  ──▶  Run Script `seance ${(z)1}`

External Trigger "cheatsheet"  ──▶  Run Script `seance cheatsheet`  ──▶  Text View (markdown preview)
```

Actioning any result runs a single script — there is no branching in the workflow. The cheatsheet reaches its Text View by calling *back* into Alfred: the palette item's arg is `cheatsheet --alfred`, and `seance cheatsheet --alfred` fires the external trigger via AppleScript. That indirection is deliberate. Routing a Script Filter result to a Text View would need a Conditional keyed on an item variable, and that path did not fire in Alfred 5.6 — the condition always fell through to its else branch. The external trigger uses only objects verified to work.
