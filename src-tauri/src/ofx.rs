//! Hand-written OFX 1.x (SGML) and 2.x (XML) bank statement parser.
//!
//! Both flavors close every aggregate (`</STMTTRN>`); only SGML leaf elements may stay
//! unclosed, so a leaf's value is the text up to the next `<`. Header lines and XML
//! processing instructions sit before `<OFX>` and are skipped.

use crate::transactions::is_date;
use crate::types::{AppError, ParsedStatement, ParsedTransaction};

/// Parses one OFX/QFX bank statement.
pub fn parse(text: &str) -> Result<ParsedStatement, AppError> {
    let ofx = text
        .find("<OFX>")
        .map(|start| &text[start..])
        .ok_or_else(|| error("This file is not an OFX or QFX statement."))?;
    match ofx.matches("<STMTRS>").count() {
        0 => return Err(error("This file has no bank statement.")),
        1 => {}
        _ => return Err(error("Zeni imports one bank statement per file.")),
    }
    let statement = aggregate(ofx, "STMTRS")
        .ok_or_else(|| error("The bank statement in this file is incomplete."))?;
    let currency = leaf(statement, "CURDEF")
        .ok_or_else(|| error("The bank statement has no currency (CURDEF)."))?;

    let (ledger_balance_cents, balance_as_of) = match aggregate(statement, "LEDGERBAL") {
        Some(ledger) => (
            Some(cents(&required(ledger, "BALAMT")?)?),
            Some(date(&required(ledger, "DTASOF")?)?),
        ),
        None => (None, None),
    };

    let mut transactions = Vec::new();
    let mut rest = statement;
    while let Some(start) = rest.find("<STMTTRN>") {
        let block = aggregate(&rest[start..], "STMTTRN")
            .filter(|block| !block["<STMTTRN>".len()..].contains("<STMTTRN>"))
            .ok_or_else(incomplete)?;
        rest = &rest[start + block.len()..];
        let memo = leaf(block, "MEMO");
        transactions.push(ParsedTransaction {
            fitid: leaf(block, "FITID"),
            posted_date: date(&required(block, "DTPOSTED")?)?,
            amount_cents: cents(&required(block, "TRNAMT")?)?,
            // NAME and PAYEE are mutually exclusive, so the first <NAME> is NAME or PAYEE/NAME.
            // Without either, MEMO is the description (our reading of V3-R4).
            description: leaf(block, "NAME")
                .or_else(|| memo.clone())
                .unwrap_or_default(),
            memo,
            transaction_type: leaf(block, "TRNTYPE"),
            original: without_transfer_accounts(block)?,
        });
    }

    Ok(ParsedStatement {
        currency,
        ledger_balance_cents,
        balance_as_of,
        transactions,
    })
}

fn error(message: impl Into<String>) -> AppError {
    AppError::Import(message.into())
}

fn incomplete() -> AppError {
    error("A transaction in this file is incomplete.")
}

/// `block` without `<BANKACCTTO>`/`<CCACCTTO>`: they hold a transfer target's routing and account
/// numbers, which must never be stored in plain text.
fn without_transfer_accounts(block: &str) -> Result<String, AppError> {
    let mut original = block.to_owned();
    for tag in ["BANKACCTTO", "CCACCTTO"] {
        while let Some(start) = original.find(&format!("<{tag}>")) {
            let len = aggregate(&original[start..], tag)
                .ok_or_else(incomplete)?
                .len();
            original.replace_range(start..start + len, "");
        }
    }
    Ok(original)
}

/// The first `<TAG>...</TAG>` in `text`, both tags included.
fn aggregate<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let start = text.find(&format!("<{tag}>"))?;
    let close = format!("</{tag}>");
    let end = text[start..].find(&close)? + start + close.len();
    Some(&text[start..end])
}

/// The decoded, trimmed text after the first `<TAG>`; `None` if missing or empty.
fn leaf(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let value = &text[text.find(&open)? + open.len()..];
    let value = value[..value.find('<').unwrap_or(value.len())].trim();
    (!value.is_empty()).then(|| decode(value))
}

fn required(text: &str, tag: &str) -> Result<String, AppError> {
    leaf(text, tag).ok_or_else(|| error(format!("A required {tag} value is missing.")))
}

fn decode(value: &str) -> String {
    // &amp; last, so "&amp;lt;" stays the literal text "&lt;".
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// Decimal text to integer cents without floats. OFX allows `.` or `,` as the decimal mark.
fn cents(value: &str) -> Result<i64, AppError> {
    let invalid = || error(format!("\"{value}\" is not a valid amount."));
    let (negative, digits) = match value.strip_prefix('-') {
        Some(digits) => (true, digits),
        None => (false, value.strip_prefix('+').unwrap_or(value)),
    };
    let (whole, fraction) = digits.split_once(['.', ',']).unwrap_or((digits, ""));
    let all_digits = whole
        .bytes()
        .chain(fraction.bytes())
        .all(|b| b.is_ascii_digit());
    if !all_digits || (whole.is_empty() && fraction.is_empty()) || fraction.len() > 2 {
        return Err(invalid());
    }
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().map_err(|_| invalid())?
    };
    let fraction: i64 = format!("{fraction:0<2}").parse().map_err(|_| invalid())?;
    let cents = whole
        .checked_mul(100)
        .and_then(|c| c.checked_add(fraction))
        .ok_or_else(invalid)?;
    Ok(if negative { -cents } else { cents })
}

/// The first 8 digits of an OFX date (`YYYYMMDD[HHMMSS[.XXX]][[TZ]]`) as "YYYY-MM-DD".
fn date(value: &str) -> Result<String, AppError> {
    let invalid = || error(format!("\"{value}\" is not a valid date."));
    let digits = value
        .get(..8)
        .filter(|d| d.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(invalid)?;
    let date = format!("{}-{}-{}", &digits[..4], &digits[4..6], &digits[6..]);
    if is_date(&date) {
        Ok(date)
    } else {
        Err(invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SGML: &str = "OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\n\r\n<OFX>\r\n<BANKMSGSRSV1><STMTTRNRS><STMTRS>\r\n<CURDEF>USD\r\n<BANKTRANLIST>\r\n<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20261002120000.000[-5:EST]\r\n<TRNAMT>-12.34\r\n<FITID>A1\r\n<NAME>Tom &amp; Jerry&apos;s\r\n<MEMO>Card 1234\r\n</STMTTRN>\r\n</BANKTRANLIST>\r\n<LEDGERBAL><BALAMT>100.5<DTASOF>20261015</LEDGERBAL>\r\n<AVAILBAL><BALAMT>99.00<DTASOF>20261015</AVAILBAL>\r\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\r\n</OFX>\r\n";

    fn xml(transactions: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<?OFX OFXHEADER=\"200\" VERSION=\"220\"?>\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF><BANKTRANLIST>{transactions}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
        )
    }

    fn import_error(result: Result<impl std::fmt::Debug, AppError>) -> String {
        match result {
            Err(AppError::Import(message)) => message,
            other => panic!("expected an Import error, got {other:?}"),
        }
    }

    #[test]
    fn parses_sgml_with_unclosed_leaves() {
        let statement = parse(SGML).unwrap();
        assert_eq!(statement.currency, "USD");
        assert_eq!(statement.ledger_balance_cents, Some(10050));
        assert_eq!(statement.balance_as_of.as_deref(), Some("2026-10-15"));
        let [row] = statement.transactions.as_slice() else {
            panic!("expected one row");
        };
        assert_eq!(row.fitid.as_deref(), Some("A1"));
        assert_eq!(row.posted_date, "2026-10-02");
        assert_eq!(row.amount_cents, -1234);
        assert_eq!(row.description, "Tom & Jerry's");
        assert_eq!(row.memo.as_deref(), Some("Card 1234"));
        assert_eq!(row.transaction_type.as_deref(), Some("DEBIT"));
        assert!(row.original.starts_with("<STMTTRN>\r\n<TRNTYPE>DEBIT"));
        assert!(row.original.ends_with("</STMTTRN>"));
    }

    #[test]
    fn parses_xml_with_payee_and_memo_fallbacks() {
        let text = xml(
            "<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261016</DTPOSTED><TRNAMT>5</TRNAMT><FITID>B1</FITID><PAYEE><NAME>A &lt;B&gt; &quot;C&quot;</NAME><ADDR1>1 Main</ADDR1></PAYEE></STMTTRN>\
             <STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20261017</DTPOSTED><TRNAMT>-1.00</TRNAMT><MEMO>Only memo</MEMO></STMTTRN>\
             <STMTTRN><DTPOSTED>20261018</DTPOSTED><TRNAMT>-2.00</TRNAMT></STMTTRN>",
        );
        let statement = parse(&text).unwrap();
        assert_eq!(statement.ledger_balance_cents, None);
        assert_eq!(statement.balance_as_of, None);
        let rows = &statement.transactions;
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].description, "A <B> \"C\"");
        assert_eq!(rows[0].amount_cents, 500);
        assert_eq!(rows[1].description, "Only memo");
        assert_eq!(rows[1].fitid, None);
        assert_eq!(rows[2].description, "");
        assert_eq!(rows[2].transaction_type, None);
        assert_eq!(
            rows[2].original,
            "<STMTTRN><DTPOSTED>20261018</DTPOSTED><TRNAMT>-2.00</TRNAMT></STMTTRN>"
        );
    }

    #[test]
    fn amounts_parse_to_cents_without_floats() {
        for (text, expected) in [
            ("-12.34", -1234),
            ("-12.3", -1230),
            ("12", 1200),
            ("+5.00", 500),
            (".5", 50),
            ("-.05", -5),
            ("7.", 700),
            ("1,25", 125),
            ("0.10", 10),
            ("92233720368547758.07", i64::MAX),
        ] {
            assert_eq!(cents(text).unwrap(), expected, "{text}");
        }
        for text in [
            "",
            "-",
            ".",
            "1.234",
            "1e5",
            "--1",
            "+-1",
            "1.2.3",
            "1,000.00",
            " 1",
            "abc",
            "92233720368547758.08",
        ] {
            assert!(cents(text).is_err(), "{text:?} should be rejected");
        }
    }

    #[test]
    fn dates_take_the_first_eight_digits_and_are_validated() {
        assert_eq!(date("20261031").unwrap(), "2026-10-31");
        assert_eq!(date("20240229120000.000[-5:EST]").unwrap(), "2024-02-29");
        for text in [
            "2026103",
            "2026-10-31",
            "20261301",
            "20261032",
            "20250229",
            "19000229",
            "00000101",
            "20261100",
        ] {
            assert!(date(text).is_err(), "{text:?} should be rejected");
        }
    }

    #[test]
    fn decodes_the_five_xml_entities_once() {
        assert_eq!(decode("&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
        assert_eq!(decode("&amp;lt;"), "&lt;");
    }

    #[test]
    fn rejects_missing_required_fields() {
        assert!(import_error(parse("OFXHEADER:100\nhello")).contains("not an OFX"));
        assert!(
            import_error(parse(
                "<OFX><CREDITCARDMSGSRSV1><CCSTMTRS></CCSTMTRS></CREDITCARDMSGSRSV1></OFX>"
            ))
            .contains("no bank statement")
        );
        assert!(import_error(parse(&SGML.replace("<CURDEF>USD", ""))).contains("CURDEF"));
        assert!(import_error(parse(&SGML.replace("<TRNAMT>-12.34", ""))).contains("TRNAMT"));
        assert!(
            import_error(parse(
                &SGML.replace("<DTPOSTED>20261002120000.000[-5:EST]", "")
            ))
            .contains("DTPOSTED")
        );
        assert!(import_error(parse(&SGML.replace("<BALAMT>100.5", ""))).contains("BALAMT"));
        assert!(import_error(parse(&SGML.replace("-12.34", "-12.345"))).contains("amount"));
        assert!(import_error(parse(&SGML.replace("20261002", "20261302"))).contains("date"));
        assert!(import_error(parse(&SGML.replace("</STMTTRN>", ""))).contains("incomplete"));
        let two = SGML.replace(
            "</STMTTRNRS>",
            "</STMTTRNRS><STMTTRNRS><STMTRS></STMTRS></STMTTRNRS>",
        );
        assert!(import_error(parse(&two)).contains("one bank statement"));
    }

    #[test]
    fn rejects_an_unclosed_transaction_followed_by_another() {
        let text = xml(
            "<STMTTRN><DTPOSTED>20261016</DTPOSTED><TRNAMT>-1.00</TRNAMT>\
             <STMTTRN><DTPOSTED>20261017</DTPOSTED><TRNAMT>-2.00</TRNAMT></STMTTRN>",
        );
        assert!(import_error(parse(&text)).contains("incomplete"));
    }

    #[test]
    fn original_drops_transfer_target_accounts() {
        let text = xml(
            "<STMTTRN><DTPOSTED>20261016</DTPOSTED><TRNAMT>-1.00</TRNAMT>\
             <BANKACCTTO><BANKID>111111111</BANKID><ACCTID>2222</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE></BANKACCTTO>\
             <CCACCTTO><ACCTID>3333</ACCTID></CCACCTTO><MEMO>Transfer</MEMO></STMTTRN>",
        );
        let statement = parse(&text).unwrap();
        assert_eq!(
            statement.transactions[0].original,
            "<STMTTRN><DTPOSTED>20261016</DTPOSTED><TRNAMT>-1.00</TRNAMT><MEMO>Transfer</MEMO></STMTTRN>"
        );
        let unclosed = text.replace("</CCACCTTO>", "");
        assert!(import_error(parse(&unclosed)).contains("incomplete"));
    }

    #[test]
    fn statement_without_transactions_is_valid() {
        let statement = parse(&xml("")).unwrap();
        assert_eq!(statement.currency, "USD");
        assert!(statement.transactions.is_empty());
    }

    fn sum(statement: &ParsedStatement) -> i64 {
        statement.transactions.iter().map(|t| t.amount_cents).sum()
    }

    #[test]
    fn parses_every_fixture() {
        let files = [
            include_str!("../tests/fixtures/checking-sgml.qfx"),
            include_str!("../tests/fixtures/checking-xml.ofx"),
            include_str!("../tests/fixtures/checking-overlap.ofx"),
            include_str!("../tests/fixtures/checking-broken-balance.ofx"),
            include_str!("../tests/fixtures/checking-cad.ofx"),
            include_str!("../tests/fixtures/checking-no-fitid.ofx"),
        ];
        for text in files {
            // Every aggregate closes in both flavors, so a mismatch means a broken fixture.
            assert_eq!(
                text.matches("<STMTTRN>").count(),
                text.matches("</STMTTRN>").count()
            );
        }
        let [sgml, xml, overlap, broken, cad, no_fitid] = files.map(|text| parse(text).unwrap());
        assert_eq!(sgml.transactions.len(), 8);
        assert_eq!(sgml.ledger_balance_cents, Some(245_000));
        assert_eq!(sgml.balance_as_of.as_deref(), Some("2026-10-15"));
        assert_eq!(sgml.transactions[3].description, "CITY POWER & LIGHT");

        assert_eq!(xml.transactions.len(), 8);
        assert_eq!(xml.balance_as_of.as_deref(), Some("2026-10-31"));
        assert_eq!(xml.ledger_balance_cents, Some(245_000 + sum(&xml)));
        assert_eq!(xml.ledger_balance_cents, Some(396_053));

        assert_eq!(overlap.transactions.len(), 9);
        let shared: Vec<_> = overlap
            .transactions
            .iter()
            .filter(|t| xml.transactions.iter().any(|x| x.fitid == t.fitid))
            .collect();
        assert_eq!(shared.len(), 4);
        let new_rows: i64 = overlap
            .transactions
            .iter()
            .filter(|t| t.posted_date.as_str() > "2026-10-31")
            .map(|t| t.amount_cents)
            .sum();
        assert_eq!(overlap.balance_as_of.as_deref(), Some("2026-11-10"));
        assert_eq!(overlap.ledger_balance_cents, Some(396_053 + new_rows));
        assert_eq!(overlap.ledger_balance_cents, Some(244_414));

        assert_eq!(broken.transactions.len(), 4);
        assert_eq!(244_414 + sum(&broken), 439_302);
        assert_eq!(broken.ledger_balance_cents, Some(439_309));
        assert_eq!(broken.balance_as_of.as_deref(), Some("2026-11-20"));

        assert_eq!(cad.currency, "CAD");
        assert_eq!(cad.transactions.len(), 2);

        assert_eq!(no_fitid.transactions.len(), 3);
        assert!(no_fitid.transactions.iter().all(|t| t.fitid.is_none()));
        assert_eq!(no_fitid.ledger_balance_cents, None);
        let [a, b, _] = no_fitid.transactions.as_slice() else {
            panic!("expected three rows");
        };
        assert_eq!(
            (&a.posted_date, a.amount_cents, &a.description),
            (&b.posted_date, b.amount_cents, &b.description)
        );
    }
}
