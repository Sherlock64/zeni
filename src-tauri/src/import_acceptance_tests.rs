//! V3 acceptance tests over the fixture files (expected values: `tests/fixtures/README.md`).

use std::path::{Path, PathBuf};

use crate::types::{
    AppError, AppState, BalanceCheck, ImportFormat, ImportSummary, RevertImportRequest,
    SortDirection, TransactionQuery, TransactionSort,
};
use crate::{db, imports, ofx, security, transactions};

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
        db: run(db::connect(&dir)),
        session: Default::default(),
    };
    run(sqlx::query(
        "INSERT INTO accounts (name, owner, bank_name, account_number, routing_number) \
         VALUES ('Checking', 'Sam', 'Bank', x'00', x'00')",
    )
    .execute(security::pool(&state).unwrap()))
    .unwrap();
    Db { state, dir }
}

fn fixture(file: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(file)
}

impl Db {
    fn import(&self, file: &str) -> Result<ImportSummary, AppError> {
        run(imports::import_path(&self.state, &fixture(file)))
    }

    fn import_ok(&self, file: &str) -> ImportSummary {
        self.import(file).unwrap()
    }

    fn raw_rows(&self) -> Vec<RawRow> {
        run(sqlx::query_as(
            "SELECT id, import_id, account_id, fitid, posted_date, amount_cents, raw_description, \
             memo, transaction_type, running_balance_cents, original_row \
             FROM raw_transactions ORDER BY id",
        )
        .fetch_all(security::pool(&self.state).unwrap()))
        .unwrap()
    }

    fn scalar(&self, sql: &'static str) -> i64 {
        run(sqlx::query_scalar(sql).fetch_one(security::pool(&self.state).unwrap())).unwrap()
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
        .execute(security::pool(&db.state).unwrap()))
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
