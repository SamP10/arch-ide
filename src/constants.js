/**
 * Centralised enumerations for Arch IDE.
 *
 * Every set of valid values lives here. All other modules import from this file.
 * Validation logic should be derived from these objects — never from ad-hoc string literals.
 *
 * @[SCHEMA_CHANGE] — if you add a status used in a DB column, update the corresponding
 * constant here AND in the relevant CREATE TABLE statement in db.js.
 */

// ----------------------------------------------------------------------------
// File parse statuses — stored in files.parse_status column
// @[SCHEMA_CHANGE] — must stay in sync with db.js files table definition
// ----------------------------------------------------------------------------
export const PARSE_STATUS = /** @type {const} */ ({
  PENDING:     'pending',     // inserted but not yet parsed
  SUCCESS:     'success',     // tree-sitter parsed successfully
  FAILED:      'failed',      // parse attempted, threw an error
  UNSUPPORTED: 'unsupported', // language not supported by current parsers
});

// ----------------------------------------------------------------------------
// Hypothesis lifecycle statuses — stored in hypotheses.status column
// @[SCHEMA_CHANGE] — must stay in sync with db.js hypotheses table definition
// ----------------------------------------------------------------------------
export const HYPOTHESIS_STATUS = /** @type {const} */ ({
  PENDING_VALIDATION: 'pending_validation', // generated, awaiting user review
  VALIDATED:          'validated',          // user accepted (with or without corrections)
  SKIPPED:            'skipped',            // user skipped the review step
});

// ----------------------------------------------------------------------------
// Diagram types — stored in diagrams.type column
// @[SCHEMA_CHANGE] — must stay in sync with db.js diagrams table definition
// ----------------------------------------------------------------------------
export const DIAGRAM_TYPE = /** @type {const} */ ({
  ARCH:  'arch',  // cluster-level architecture overview (Mermaid)
  DEPS:  'deps',  // hotspot dependency graph (Mermaid)
  CALLS: 'calls', // call graph for top hotspots (Mermaid)
});

// ----------------------------------------------------------------------------
// Git file statuses — used in session change reports
// Values must match what getGitChanges() sets; report.js formats based on these.
// ----------------------------------------------------------------------------
export const GIT_FILE_STATUS = /** @type {const} */ ({
  ADDED:    'added',    // file exists in new commit but not in parent
  MODIFIED: 'modified', // file exists in both commits, OID differs
  DELETED:  'deleted',  // file exists in parent but not in new commit
});

// isomorphic-git statusMatrix returns [filepath, head, workdir, stage].
// head and workdir use these numeric codes.
// DO NOT CHANGE — these are isomorphic-git internal constants, not our invention.
// See: https://isomorphic-git.org/docs/en/statusMatrix
export const GIT_STATUS_CODE = /** @type {const} */ ({
  ABSENT:   0, // file does not exist at this ref
  PRESENT:  1, // file exists and is unchanged
  MODIFIED: 2, // file exists but differs from the ref
});

// ----------------------------------------------------------------------------
// Drift signal types — emitted by detectDrift() in session/drift.js
// ----------------------------------------------------------------------------
export const DRIFT_SIGNAL_TYPE = /** @type {const} */ ({
  ORPHAN_FILE:         'orphan_file',         // changed file not present in DB (new since last ingestion)
  KEY_FILE_MODIFIED:   'key_file_modified',   // hypothesis key_file was modified
  KEY_FILE_DELETED:    'key_file_deleted',    // hypothesis key_file was deleted — highest severity
  CROSS_LAYER_CHURN:   'cross_layer_churn',   // one author touched ≥N architectural layers
  LAYER_CONCENTRATION: 'layer_concentration', // >X% of changes in a single layer
  UNTRACKED_ADDITION:  'untracked_addition',  // added file with no cluster assignment
  HOTSPOT_CHURN:       'hotspot_churn',       // changed file has high hotspot score
});

// Severity levels for drift signals, in ascending order of concern.
export const SIGNAL_SEVERITY = /** @type {const} */ ({
  INFO:     'info',     // notable but not actionable
  WARNING:  'warning',  // should be reviewed before merge
  CRITICAL: 'critical', // blocks architectural integrity
});

// ----------------------------------------------------------------------------
// Session report modes — set in meta.mode by session/index.js
// Drives the formatter branch in session/report.js formatHumanReadable().
// ----------------------------------------------------------------------------
export const SESSION_MODE = /** @type {const} */ ({
  NORMAL:        'normal',        // baseline + hypothesis present, git changes diffed
  FIRST_RUN:     'first_run',     // no completed ingestion run found in DB
  NO_HYPOTHESIS: 'no_hypothesis', // run exists but no validated hypothesis
  NO_GIT:        'no_git',        // target directory is not a git repository
});

// ----------------------------------------------------------------------------
// Hypothesis correction types — recorded when user edits during validate stage
// @[SCHEMA_CHANGE] — stored in hypotheses.corrections_json; changing these
// breaks existing DB records.
// ----------------------------------------------------------------------------
export const CORRECTION_TYPE = /** @type {const} */ ({
  RENAME_LAYER:       'rename_layer',       // layer name changed
  SET_RESPONSIBILITY: 'set_responsibility', // layer responsibility text updated
  REASSIGN_CLUSTER:   'reassign_cluster',   // cluster moved to different layer
  ADD_LAYER:          'add_layer',          // new layer created
  REMOVE_LAYER:       'remove_layer',       // existing layer deleted
  SET_ARCH_STYLE:     'set_arch_style',     // top-level architecture_style updated
  SET_ENTRY_POINTS:   'set_entry_points',   // entry_points array replaced
});
