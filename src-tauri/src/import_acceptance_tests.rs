//! V3 and V3.1 acceptance tests over the fixture files (expected values: `tests/fixtures/README.md`).

use std::path::{Path, PathBuf};

use crate::types::{
    AmountColumns, AppError, AppState, BalanceCheck, CommitImportRequest, CsvMapping, DateFormat,
    DeleteCsvLayoutRequest, FileBalanceCheck, ImportFormat, ImportReview, ImportStep,
    ImportSummary, RevertImportRequest, SaveCsvLayoutRequest, SortDirection, TransactionQuery,
    TransactionSort, UpdateCsvLayoutRequest,
};
use crate::{csv_layouts, db, imports, ofx, security, transactions};

/// Every `raw_transactions` column, in table order.
type RawRow = (
    i64,
    i64,
    i64,
    Option<String>,
    String,
    i64,
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    String,
    Option<String>,
);

/// (posted_date, amount_cents, description, memo, transaction_type)
type Shown = (String, i64, String, Option<String>, Option<String>);

struct Db {
    state: AppState,
    dir: PathBuf,
}

impl Drop for Db {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn run<T>(future: impl Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

/// A fresh database with one account.
fn database(name: &str) -> Db {
    let dir = db::temp_dir(&format!("acceptance-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    let state = AppState {
        db: std::sync::RwLock::new(run(db::connect(&dir))),
        session: Default::default(),
        backup: Default::default(),
        pending_import: Default::default(),
    };
    run(sqlx::query(
        "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
         VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
    )
    .execute(&security::pool(&state).unwrap()))
    .unwrap();
    Db { state, dir }
}

fn fixture(file: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(file)
}

fn sample(file: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../samples")
        .join(file)
}

fn imported(step: ImportStep) -> ImportSummary {
    match step {
        ImportStep::Imported(summary) => summary,
        other => panic!("expected Imported, got {other:?}"),
    }
}

fn review(step: ImportStep) -> ImportReview {
    match step {
        ImportStep::Review(review) => review,
        other => panic!("expected Review, got {other:?}"),
    }
}

fn import_error(result: Result<ImportStep, AppError>) -> String {
    match result {
        Err(AppError::Import(message)) => message,
        other => panic!("expected an Import error, got {other:?}"),
    }
}

/// The fixtures README's bank layout (also the samples' CSV layout).
fn bank_mapping() -> CsvMapping {
    CsvMapping {
        date_format: DateFormat::MmDdYyyy,
        posted_date: 1,
        description: 8,
        amount: AmountColumns::Signed { column: 5 },
        transaction_id: Some(0),
        memo: Some(13),
        transaction_type: Some(3),
        running_balance: Some(11),
        posting_status: Some(4),
        bank_category: Some(9),
    }
}

fn split_mapping() -> CsvMapping {
    CsvMapping {
        date_format: DateFormat::MDYyyy,
        posted_date: 0,
        description: 1,
        amount: AmountColumns::Split {
            debit: 2,
            credit: 3,
        },
        transaction_id: None,
        memo: None,
        transaction_type: None,
        running_balance: Some(4),
        posting_status: None,
        bank_category: None,
    }
}

fn overlap_mapping() -> CsvMapping {
    CsvMapping {
        date_format: DateFormat::YyyyMmDd,
        posted_date: 0,
        description: 1,
        amount: AmountColumns::Signed { column: 2 },
        transaction_id: None,
        memo: None,
        transaction_type: None,
        running_balance: None,
        posting_status: None,
        bank_category: None,
    }
}

/// (added, duplicates, not posted, review skipped, file balance check)
fn csv_counts(summary: &ImportSummary) -> (u32, u32, u32, u32, FileBalanceCheck) {
    (
        summary.added,
        summary.duplicates,
        summary.not_posted,
        summary.review_skipped,
        summary.file_balance_check,
    )
}

impl Db {
    fn step_at(&self, path: &Path) -> Result<ImportStep, AppError> {
        run(imports::import_path(&self.state, path))
    }

    fn step(&self, file: &str) -> Result<ImportStep, AppError> {
        self.step_at(&fixture(file))
    }

    fn import(&self, file: &str) -> Result<ImportSummary, AppError> {
        self.step(file).map(imported)
    }

    fn import_ok(&self, file: &str) -> ImportSummary {
        self.import(file).unwrap()
    }

    fn save(&self, name: &str, mapping: CsvMapping) -> Result<ImportStep, AppError> {
        run(imports::save_csv_layout(
            &self.state,
            SaveCsvLayoutRequest {
                name: name.into(),
                mapping,
            },
        ))
    }

    /// Imports a CSV whose header is new: it needs a mapping, then saving the layout imports it.
    fn import_mapped_at(&self, path: &Path, name: &str, mapping: CsvMapping) -> ImportSummary {
        assert!(matches!(
            self.step_at(path).unwrap(),
            ImportStep::NeedsMapping(_)
        ));
        imported(self.save(name, mapping).unwrap())
    }

    fn import_mapped(&self, file: &str, name: &str, mapping: CsvMapping) -> ImportSummary {
        self.import_mapped_at(&fixture(file), name, mapping)
    }

    fn commit(&self, skip_rows: Vec<u32>) -> Result<ImportSummary, AppError> {
        run(imports::commit_import(
            &self.state,
            CommitImportRequest { skip_rows },
        ))
    }

    fn descriptions(&self, import_id: i64) -> Vec<String> {
        run(sqlx::query_scalar(
            "SELECT raw_description FROM raw_transactions WHERE import_id = ? ORDER BY id",
        )
        .bind(import_id)
        .fetch_all(&security::pool(&self.state).unwrap()))
        .unwrap()
    }

    fn raw_rows(&self) -> Vec<RawRow> {
        run(sqlx::query_as(
            "SELECT id, import_id, account_id, fitid, posted_date, amount_cents, raw_description, \
             memo, transaction_type, running_balance_cents, original_row, bank_category \
             FROM raw_transactions ORDER BY id",
        )
        .fetch_all(&security::pool(&self.state).unwrap()))
        .unwrap()
    }

    fn scalar(&self, sql: &'static str) -> i64 {
        run(sqlx::query_scalar(sql).fetch_one(&security::pool(&self.state).unwrap())).unwrap()
    }

    /// Every transaction as `transactions::list` shows it, sorted.
    fn shown(&self) -> Vec<Shown> {
        let page = run(transactions::list(
            &self.state,
            TransactionQuery {
                from: None,
                to: None,
                search: None,
                sort: TransactionSort::Date,
                direction: SortDirection::Asc,
                page: 0,
                page_size: 200,
            },
        ))
        .unwrap();
        assert_eq!(page.total as usize, page.rows.len());
        let mut rows: Vec<Shown> = page
            .rows
            .into_iter()
            .map(|row| {
                (
                    row.posted_date,
                    row.amount_cents,
                    row.description,
                    row.memo,
                    row.transaction_type,
                )
            })
            .collect();
        rows.sort();
        rows
    }
}

/// The fixtures' parsed rows, deduplicated by FITID, as `transactions::list` should show them.
fn expected(files: &[&str]) -> Vec<Shown> {
    let mut seen = std::collections::HashSet::new();
    let mut rows: Vec<Shown> = files
        .iter()
        .flat_map(|file| {
            ofx::parse(&std::fs::read_to_string(fixture(file)).unwrap())
                .unwrap()
                .transactions
        })
        .filter(|row| seen.insert(row.fitid.clone().unwrap()))
        .map(|row| {
            (
                row.posted_date,
                row.amount_cents,
                row.description,
                row.memo,
                row.transaction_type,
            )
        })
        .collect();
    rows.sort();
    rows
}

fn outcome(summary: &ImportSummary) -> (u32, u32, BalanceCheck, Option<i64>, Option<i64>) {
    (
        summary.added,
        summary.duplicates,
        summary.balance_check,
        summary.ledger_balance_cents,
        summary.expected_balance_cents,
    )
}

/// AC1, AC3, AC4, AC5, AC6, AC7, AC8, AC10 in the README's import order, plus AC2 on top.
#[test]
fn fixture_sequence_imports_dedupes_checks_balances_and_reverts() {
    let db = database("sequence");
    use BalanceCheck::*;

    // AC1, AC5, AC8: SGML QFX is the baseline.
    let sgml = db.import_ok("checking-sgml.qfx");
    assert_eq!(sgml.format, ImportFormat::Qfx);
    assert_eq!(sgml.file_name, "checking-sgml.qfx");
    assert_eq!(outcome(&sgml), (8, 0, Baseline, Some(245000), None));
    // AC3: same QFX again adds nothing and matches the first import's balance.
    let sgml_again = db.import_ok("checking-sgml.qfx");
    assert_eq!(
        outcome(&sgml_again),
        (0, 8, Passed, Some(245000), Some(245000))
    );
    assert_eq!(db.shown(), expected(&["checking-sgml.qfx"]));

    // AC1, AC5, AC8: XML OFX passes the balance check.
    let xml = db.import_ok("checking-xml.ofx");
    assert_eq!(xml.format, ImportFormat::Ofx);
    assert_eq!(outcome(&xml), (8, 0, Passed, Some(396053), Some(396053)));
    // AC3: same OFX again.
    let xml_again = db.import_ok("checking-xml.ofx");
    assert_eq!(xml_again.added, 0);
    assert_eq!(xml_again.duplicates, 8);
    assert_eq!(
        db.shown(),
        expected(&["checking-sgml.qfx", "checking-xml.ofx"])
    );

    // AC4, AC5, AC8: only the 5 new overlap rows are added.
    let overlap = db.import_ok("checking-overlap.ofx");
    assert_eq!(
        outcome(&overlap),
        (5, 4, Passed, Some(244414), Some(244414))
    );

    // AC8: broken balance is 7 cents off.
    let broken = db.import_ok("checking-broken-balance.ofx");
    assert_eq!(
        outcome(&broken),
        (4, 0, Mismatch, Some(439309), Some(439302))
    );

    let all = [
        "checking-sgml.qfx",
        "checking-xml.ofx",
        "checking-overlap.ofx",
        "checking-broken-balance.ofx",
    ];
    assert_eq!(db.shown(), expected(&all));
    assert_eq!(db.shown().len(), 25);

    // AC2: CAD is rejected and nothing is recorded.
    let before = db.raw_rows();
    let imports_before = db.scalar("SELECT COUNT(*) FROM imports");
    match db.import("checking-cad.ofx") {
        Err(AppError::Import(message)) => assert_eq!(
            message,
            "Zeni only imports US dollar statements; this file is in CAD."
        ),
        other => panic!("expected an Import error, got {other:?}"),
    }
    assert_eq!(db.scalar("SELECT COUNT(*) FROM imports"), imports_before);
    assert_eq!(db.raw_rows(), before);

    // AC5: history, newest first, with the stored row counts and checks.
    let history = run(imports::list(&db.state)).unwrap();
    let summary: Vec<_> = history
        .iter()
        .map(|record| {
            (
                record.id,
                record.row_count,
                record.balance_check,
                record.ledger_balance_cents,
                record.expected_balance_cents,
            )
        })
        .collect();
    assert_eq!(
        summary,
        [
            (broken.import_id, 4, Mismatch, Some(439309), Some(439302)),
            (overlap.import_id, 5, Passed, Some(244414), Some(244414)),
            (xml_again.import_id, 0, Passed, Some(396053), Some(396053)),
            (xml.import_id, 8, Passed, Some(396053), Some(396053)),
            (sgml_again.import_id, 0, Passed, Some(245000), Some(245000)),
            (sgml.import_id, 8, Baseline, Some(245000), None),
        ]
    );

    // AC10: every amount is stored as an integer.
    assert_eq!(
        db.scalar("SELECT COUNT(*) FROM raw_transactions WHERE typeof(amount_cents) <> 'integer'"),
        0
    );
    assert_eq!(
        db.scalar(
            "SELECT COUNT(*) FROM imports WHERE ledger_balance_cents IS NOT NULL \
             AND typeof(ledger_balance_cents) <> 'integer'"
        ),
        0
    );

    // AC6, AC7: reverting the XML import removes exactly its rows; every other row is untouched.
    run(imports::revert(
        &db.state,
        RevertImportRequest {
            import_id: xml.import_id,
        },
    ))
    .unwrap();
    let kept: Vec<RawRow> = before
        .into_iter()
        .filter(|row| row.1 != xml.import_id)
        .collect();
    assert_eq!(kept.len(), 17);
    assert_eq!(db.raw_rows(), kept);
    // The 4 overlap rows shared with the XML file were stored by the XML import, so they go too.
    let xml_rows = expected(&["checking-xml.ofx"]);
    let mut remaining = expected(&all);
    remaining.retain(|row| !xml_rows.contains(row));
    assert_eq!(db.shown(), remaining);
    // Later imports keep their stored balance check results.
    let after: Vec<_> = run(imports::list(&db.state))
        .unwrap()
        .iter()
        .map(|record| {
            (
                record.id,
                record.balance_check,
                record.ledger_balance_cents,
                record.expected_balance_cents,
            )
        })
        .collect();
    let kept_checks: Vec<_> = summary
        .iter()
        .filter(|record| record.0 != xml.import_id)
        .map(|&(id, _, check, ledger, expected)| (id, check, ledger, expected))
        .collect();
    assert_eq!(after, kept_checks);

    // AC7: the trigger blocks any UPDATE of a raw row.
    let error = run(sqlx::query("UPDATE raw_transactions SET amount_cents = 0")
        .execute(&security::pool(&db.state).unwrap()))
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("raw transactions are never modified")
    );
    assert_eq!(db.raw_rows(), kept);
}

/// Rows without a FITID are matched only against earlier imports, never within the same file.
#[test]
fn no_fitid_rows_dedupe_only_against_earlier_imports() {
    let db = database("no-fitid");
    let first = db.import_ok("checking-no-fitid.ofx");
    assert_eq!(
        outcome(&first),
        (3, 0, BalanceCheck::NotChecked, None, None)
    );
    let again = db.import_ok("checking-no-fitid.ofx");
    assert_eq!(
        outcome(&again),
        (0, 3, BalanceCheck::NotChecked, None, None)
    );
    assert_eq!(db.scalar("SELECT COUNT(*) FROM raw_transactions"), 3);
}

/// The manual-testing samples in `samples/` (see its README) stay importable and consecutive.
#[test]
fn samples_import_as_consecutive_months() {
    let db = database("samples");
    let month = |file: &str| imported(db.step_at(&sample(file)).unwrap());
    use BalanceCheck::*;
    assert_eq!(
        outcome(&month("checking-2026-08.ofx")),
        (26, 0, Baseline, Some(486851), None)
    );
    assert_eq!(
        outcome(&month("checking-2026-09.qfx")),
        (27, 0, Passed, Some(658651), Some(658651))
    );
    let october = db.import_mapped_at(&sample("checking-2026-10.csv"), "Bank", bank_mapping());
    assert_eq!(
        outcome(&october),
        (27, 0, Passed, Some(1029791), Some(1029791))
    );
    assert_eq!(
        csv_counts(&october),
        (27, 0, 1, 0, FileBalanceCheck::Passed)
    );
}

/// V3.1 AC1: an unknown header needs a mapping; once saved, a file with the same header imports straight away.
#[test]
fn unknown_csv_header_needs_a_mapping_once() {
    let db = database("csv-mapping");
    let ImportStep::NeedsMapping(needed) = db.step("checking-bank.csv").unwrap() else {
        panic!("expected NeedsMapping");
    };
    assert_eq!(needed.file_name, "checking-bank.csv");
    assert_eq!(needed.headers.len(), 14);
    assert_eq!(
        (needed.headers[0].as_str(), needed.headers[13].as_str()),
        ("Transaction ID", "Extended Description")
    );
    assert_eq!(needed.rows.len(), 5);
    assert_eq!(needed.rows[0][4], "Pending");
    assert_eq!(db.scalar("SELECT COUNT(*) FROM imports"), 0);

    // The draft preview reads the pending file.
    let preview = imports::preview_csv_mapping(&db.state, bank_mapping()).unwrap();
    assert_eq!(preview.len(), 5);
    assert_eq!((preview[1].line, preview[1].amount_cents), (3, Some(-3850)));

    let first = imported(db.save("  Bank  ", bank_mapping()).unwrap());
    assert_eq!(first.format, ImportFormat::Csv);
    assert_eq!(first.added, 6);
    let layouts = run(csv_layouts::list(&db.state)).unwrap();
    assert_eq!(layouts.len(), 1);
    assert_eq!(layouts[0].name, "Bank");
    assert_eq!(layouts[0].mapping, bank_mapping());
    assert_eq!(
        db.scalar("SELECT csv_layout_id FROM imports"),
        layouts[0].id
    );

    // Same header, no mapping step.
    let second = db.import_ok("checking-bank-reimport.csv");
    assert_eq!((second.added, second.duplicates), (3, 2));
    assert_eq!(
        db.scalar("SELECT COUNT(*) FROM imports WHERE csv_layout_id IS NOT NULL"),
        2
    );
}

/// V3.1 AC2, AC3, AC4, AC6, AC10: the README's CSV steps 7-9 after the six OFX steps.
#[test]
fn csv_fixtures_follow_the_ofx_steps() {
    let db = database("csv-sequence");
    for file in [
        "checking-sgml.qfx",
        "checking-xml.ofx",
        "checking-overlap.ofx",
        "checking-broken-balance.ofx",
        "checking-no-fitid.ofx",
    ] {
        db.import_ok(file);
    }
    use BalanceCheck::*;

    // Step 7: signed amounts, pending skipped, running balance feeds the V3 check.
    let bank = db.import_mapped("checking-bank.csv", "Bank", bank_mapping());
    assert_eq!(outcome(&bank), (6, 0, Passed, Some(630401), Some(630401)));
    assert_eq!(csv_counts(&bank), (6, 0, 1, 0, FileBalanceCheck::Passed));
    let stored: Vec<(Option<String>, String, i64)> = run(sqlx::query_as(
        "SELECT fitid, posted_date, amount_cents FROM raw_transactions WHERE import_id = ? ORDER BY id",
    )
    .bind(bank.import_id)
    .fetch_all(&security::pool(&db.state).unwrap()))
    .unwrap();
    let amounts: Vec<i64> = stored.iter().map(|row| row.2).collect();
    assert_eq!(amounts, [-3850, -425, -4500, 210000, -6000, -1234]);
    // AC4: the pending Dec 1 row isn't stored.
    assert!(stored.iter().all(|row| row.1 != "2026-12-01"));
    let payroll: (
        String,
        Option<String>,
        Option<String>,
        Option<i64>,
        Option<String>,
        String,
    ) = run(sqlx::query_as(
        "SELECT raw_description, memo, transaction_type, running_balance_cents, bank_category, \
             original_row FROM raw_transactions WHERE fitid = '20261125 ECB 00103'",
    )
    .fetch_one(&security::pool(&db.state).unwrap()))
    .unwrap();
    assert_eq!(
        payroll,
        (
            "Acme Payroll".into(),
            Some("ACME PAYROLL, DIRECT DEP".into()),
            Some("Credit".into()),
            Some(639176),
            Some("Paychecks".into()),
            r#""20261125 ECB 00103","11/25/2026","11/25/2026","Credit","Posted","2100.00000","","300000103","Acme Payroll","Paychecks","ACH","6391.76000","","ACME PAYROLL, DIRECT DEP""#.into(),
        )
    );

    // Step 8, AC3: the re-import adds only the new rows.
    let reimport = db.import_ok("checking-bank-reimport.csv");
    assert_eq!(
        outcome(&reimport),
        (3, 2, Passed, Some(646061), Some(646061))
    );
    assert_eq!(
        csv_counts(&reimport),
        (3, 2, 0, 0, FileBalanceCheck::Passed)
    );

    // Step 9, AC2: debit/credit columns.
    let split = db.import_mapped("checking-split.csv", "Split", split_mapping());
    assert_eq!(outcome(&split), (4, 0, Passed, Some(844181), Some(844181)));
    assert_eq!(split.file_balance_check, FileBalanceCheck::Passed);
    let split_amounts: Vec<i64> = run(sqlx::query_scalar(
        "SELECT amount_cents FROM raw_transactions WHERE import_id = ? ORDER BY id",
    )
    .bind(split.import_id)
    .fetch_all(&security::pool(&db.state).unwrap()))
    .unwrap();
    assert_eq!(split_amounts, [-2310, 210000, -9120, -450]);

    // AC3: the same file again adds nothing and matches its own earlier balance.
    let again = db.import_ok("checking-bank.csv");
    assert_eq!(outcome(&again), (0, 6, Passed, Some(630401), Some(630401)));
    assert_eq!(again.not_posted, 1);

    // AC10: integer cents, and the trigger blocks any UPDATE of a raw row.
    assert_eq!(
        db.scalar(
            "SELECT COUNT(*) FROM raw_transactions WHERE typeof(amount_cents) <> 'integer' \
             OR (running_balance_cents IS NOT NULL AND typeof(running_balance_cents) <> 'integer')"
        ),
        0
    );
    let before = db.raw_rows();
    let error = run(
        sqlx::query("UPDATE raw_transactions SET bank_category = 'X'")
            .execute(&security::pool(&db.state).unwrap()),
    )
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("raw transactions are never modified")
    );
    assert_eq!(db.raw_rows(), before);
}

/// V3.1 AC3: without a mapped ID column, rows dedupe on date + amount + description.
#[test]
fn csv_reimport_without_an_id_column_adds_nothing() {
    let db = database("csv-no-id");
    let mapping = CsvMapping {
        transaction_id: None,
        ..bank_mapping()
    };
    let first = db.import_mapped("checking-bank.csv", "Bank without ID", mapping);
    assert_eq!((first.added, first.duplicates), (6, 0));
    let again = db.import_ok("checking-bank.csv");
    assert_eq!((again.added, again.duplicates), (0, 6));
    let reimport = db.import_ok("checking-bank-reimport.csv");
    assert_eq!((reimport.added, reimport.duplicates), (3, 2));
    assert_eq!(
        db.scalar("SELECT COUNT(*) FROM raw_transactions WHERE fitid IS NOT NULL"),
        0
    );
}

/// V3.1 AC5: a CSV overlapping an OFX import goes to review; "Yes" rows aren't stored, "No" rows are,
/// and Cancel stores nothing.
#[test]
fn csv_overlapping_ofx_is_reviewed_before_anything_is_stored() {
    let db = database("csv-overlap");
    db.import_ok("checking-sgml.qfx");
    db.import_ok("checking-xml.ofx");
    let rows_before = db.raw_rows();

    assert!(matches!(
        db.step("checking-overlap-ofx.csv").unwrap(),
        ImportStep::NeedsMapping(_)
    ));
    let first = review(db.save("Overlap", overlap_mapping()).unwrap());
    assert_eq!(first.file_name, "checking-overlap-ofx.csv");
    assert_eq!(first.format, ImportFormat::Csv);
    let expected_pairs = [
        (
            0,
            "2026-10-16",
            "2026-10-16",
            -4210,
            "Fresh Market",
            "FRESH MARKET",
        ),
        (
            1,
            "2026-10-19",
            "2026-10-18",
            -12055,
            "Water and Sewer",
            "WATER & SEWER DEPT",
        ),
        (
            2,
            "2026-10-22",
            "2026-10-20",
            -30000,
            "Check 1002",
            "CHECK 1002",
        ),
    ];
    let pairs: Vec<_> = first
        .pairs
        .iter()
        .map(|pair| {
            assert_eq!(pair.existing_file_name, "checking-xml.ofx");
            assert_eq!(pair.existing_format, ImportFormat::Ofx);
            assert_eq!(pair.new_row.amount_cents, pair.existing.amount_cents);
            (
                pair.row_index,
                pair.new_row.posted_date.as_str(),
                pair.existing.posted_date.as_str(),
                pair.new_row.amount_cents,
                pair.new_row.description.as_str(),
                pair.existing.description.as_str(),
            )
        })
        .collect();
    assert_eq!(pairs, expected_pairs);

    // Cancel stores nothing, but the layout stays saved.
    imports::cancel_import(&db.state);
    assert_eq!(db.scalar("SELECT COUNT(*) FROM imports"), 2);
    assert_eq!(db.raw_rows(), rows_before);
    assert!(matches!(db.commit(vec![]), Err(AppError::NotFound(_))));

    // "Yes" to every pair: only the two non-suspects are stored.
    let second = review(db.step("checking-overlap-ofx.csv").unwrap());
    assert_eq!(second.pairs.len(), 3);
    // Only suspect rows, each once; a rejected list keeps the review pending.
    for (skip, message) in [
        (vec![3], "Row 3 isn't a suspected duplicate in this review."),
        (vec![0, 0], "Row 0 is listed more than once."),
    ] {
        match db.commit(skip) {
            Err(AppError::Validation(text)) => assert_eq!(text, message),
            other => panic!("expected a Validation error, got {other:?}"),
        }
    }
    assert_eq!(db.scalar("SELECT COUNT(*) FROM imports"), 2);
    let skipped = db.commit(vec![0, 1, 2]).unwrap();
    assert_eq!(
        csv_counts(&skipped),
        (2, 0, 0, 3, FileBalanceCheck::NotChecked)
    );
    assert_eq!(
        outcome(&skipped),
        (2, 0, BalanceCheck::NotChecked, None, None)
    );
    assert_eq!(
        db.descriptions(skipped.import_id),
        ["Book Nook", "Gas N Go"]
    );
    // The pending import is gone after a commit.
    assert!(matches!(db.commit(vec![]), Err(AppError::NotFound(_))));

    // "Yes" to one pair, "No" to the others.
    run(imports::revert(
        &db.state,
        RevertImportRequest {
            import_id: skipped.import_id,
        },
    ))
    .unwrap();
    review(db.step("checking-overlap-ofx.csv").unwrap());
    let mixed = db.commit(vec![0]).unwrap();
    assert_eq!((mixed.added, mixed.review_skipped), (4, 1));
    assert_eq!(
        db.descriptions(mixed.import_id),
        ["Water and Sewer", "Check 1002", "Book Nook", "Gas N Go"]
    );

    // "No" to every pair: all five are stored.
    run(imports::revert(
        &db.state,
        RevertImportRequest {
            import_id: mixed.import_id,
        },
    ))
    .unwrap();
    review(db.step("checking-overlap-ofx.csv").unwrap());
    let kept = db.commit(vec![]).unwrap();
    assert_eq!((kept.added, kept.review_skipped), (5, 0));
}

/// V3.1 AC5: the review applies the other way too, an OFX after a CSV.
#[test]
fn ofx_after_an_overlapping_csv_is_reviewed() {
    let db = database("ofx-after-csv");
    let csv = db.import_mapped("checking-overlap-ofx.csv", "Overlap", overlap_mapping());
    assert_eq!(csv.added, 5);
    let review = review(db.step("checking-xml.ofx").unwrap());
    assert_eq!(review.format, ImportFormat::Ofx);
    let pairs: Vec<_> = review
        .pairs
        .iter()
        .map(|pair| {
            assert_eq!(pair.existing_file_name, "checking-overlap-ofx.csv");
            assert_eq!(pair.existing_format, ImportFormat::Csv);
            (
                pair.row_index,
                pair.new_row.description.as_str(),
                pair.existing.description.as_str(),
            )
        })
        .collect();
    assert_eq!(
        pairs,
        [
            (0, "FRESH MARKET", "Fresh Market"),
            (1, "WATER & SEWER DEPT", "Water and Sewer"),
            (2, "CHECK 1002", "Check 1002"),
        ]
    );
    let summary = db.commit(vec![1]).unwrap();
    assert_eq!(
        (summary.added, summary.duplicates, summary.review_skipped),
        (7, 0, 1)
    );
    assert_eq!(summary.format, ImportFormat::Ofx);
    assert_eq!(summary.file_balance_check, FileBalanceCheck::NotChecked);
}

/// V3.1 AC6: a broken running balance flags the import and still feeds the V3 check.
#[test]
fn broken_running_balance_flags_the_import() {
    let db = database("csv-broken-balance");
    let summary = db.import_mapped(
        "checking-broken-running-balance.csv",
        "Bank",
        bank_mapping(),
    );
    assert_eq!(
        csv_counts(&summary),
        (3, 0, 0, 0, FileBalanceCheck::Mismatch)
    );
    assert_eq!(
        outcome(&summary),
        (3, 0, BalanceCheck::Baseline, Some(146501), None)
    );
    let record = &run(imports::list(&db.state)).unwrap()[0];
    assert_eq!(record.file_balance_check, FileBalanceCheck::Mismatch);
    assert_eq!(record.balance_as_of.as_deref(), Some("2026-12-12"));
}

/// V3.1 AC7: a sub-cent amount or a bad date rejects the file and stores nothing.
#[test]
fn sub_cent_amounts_and_bad_dates_reject_the_file() {
    let db = database("csv-rejects");
    let sub_cent = "Line 3: Amount 0.00500 isn't a whole number of cents.";
    // While mapping: nothing is saved and the file stays pending.
    assert!(matches!(
        db.step("checking-sub-cent.csv").unwrap(),
        ImportStep::NeedsMapping(_)
    ));
    assert_eq!(import_error(db.save("Bank", bank_mapping())), sub_cent);
    assert_eq!(db.scalar("SELECT COUNT(*) FROM csv_layouts"), 0);
    assert!(imports::preview_csv_mapping(&db.state, bank_mapping()).is_ok());
    imports::cancel_import(&db.state);

    // With a saved layout: rejected straight away, pointing at the layout.
    db.import_mapped("checking-bank.csv", "Bank", bank_mapping());
    let rows = db.raw_rows();
    let hint = " If the saved layout is wrong, edit it in Settings > CSV layouts.";
    assert_eq!(
        import_error(db.step("checking-sub-cent.csv")),
        format!("{sub_cent}{hint}")
    );
    assert_eq!(
        import_error(db.step("checking-bad-date.csv")),
        format!("Line 2: Posting Date 13/05/2026 isn't a MM/DD/YYYY date.{hint}")
    );
    assert_eq!(db.scalar("SELECT COUNT(*) FROM imports"), 1);
    assert_eq!(db.raw_rows(), rows);
}

/// V3.1 AC8: editing or deleting a layout changes no imported row or import record.
#[test]
fn editing_and_deleting_a_layout_keeps_imported_data() {
    let db = database("csv-layout-edit");
    db.import_mapped("checking-bank.csv", "Bank", bank_mapping());
    let rows = db.raw_rows();
    let records = format!("{:?}", run(imports::list(&db.state)).unwrap());
    let layout_id = run(csv_layouts::list(&db.state)).unwrap()[0].id;

    let updated = run(csv_layouts::update(
        &db.state,
        UpdateCsvLayoutRequest {
            layout_id,
            name: "Bank, no ID".into(),
            mapping: CsvMapping {
                transaction_id: None,
                ..bank_mapping()
            },
        },
    ))
    .unwrap();
    assert_eq!(updated.name, "Bank, no ID");
    assert_eq!(db.raw_rows(), rows);
    assert_eq!(
        format!("{:?}", run(imports::list(&db.state)).unwrap()),
        records
    );
    assert_eq!(db.scalar("SELECT csv_layout_id FROM imports"), layout_id);

    run(csv_layouts::delete(
        &db.state,
        DeleteCsvLayoutRequest { layout_id },
    ))
    .unwrap();
    assert_eq!(db.raw_rows(), rows);
    assert_eq!(
        format!("{:?}", run(imports::list(&db.state)).unwrap()),
        records
    );
    assert_eq!(
        db.scalar("SELECT COUNT(*) FROM imports WHERE csv_layout_id IS NULL"),
        1
    );
    // Without the layout, the header needs a mapping again.
    assert!(matches!(
        db.step("checking-bank.csv").unwrap(),
        ImportStep::NeedsMapping(_)
    ));
}
