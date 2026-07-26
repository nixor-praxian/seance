# Alfred workflow for seance

An Alfred 5 workflow that fronts the `seance` CLI. Type `s ` in Alfred; results come from `seance json query "<q>"` (Script Filter JSON), and actioning a result runs `seance <arg>` (e.g. `seance organize`, `seance focus zeus`).

## Install

**Via the CLI:**

```bash
seance alfred install
```

Copies `alfred/seance-workflow` into Alfred's workflows directory.

**Manually:**

Copy the folder into Alfred's workflows directory and reload Alfred:

```bash
cp -R alfred/seance-workflow "$HOME/Library/Application Support/Alfred/Alfred.alfredpreferences/workflows/seance-workflow"
```

(If Alfred syncs its preferences to a custom folder, use `<syncfolder>/Alfred.alfredpreferences/workflows` instead — check `defaults read com.runningwithcrayons.Alfred-Preferences syncfolder`.) Then open Alfred Preferences → Workflows, or restart Alfred, to pick it up.
