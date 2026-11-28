//! The one parser from amount text to integer cents, shared by the OFX and CSV importers.

use crate::types::{AmountError, AmountStyle, Cents};

/// What one source's amount text may look like.
struct Rules {
    plus: bool,
    dollar: bool,
    marks: &'static [char],
    /// Most digits after the mark; digits past the second must be zero.
    max_fraction: usize,
    /// `.5` is an amount.
    empty_whole: bool,
    /// `7.` is an amount.
    empty_fraction: bool,
}

const OFX: Rules = Rules {
    plus: true,
    dollar: false,
    marks: &['.', ','],
    max_fraction: 2,
    empty_whole: true,
    empty_fraction: true,
};

const CSV: Rules = Rules {
    plus: false,
    dollar: true,
    marks: &['.'],
    max_fraction: 5,
    empty_whole: false,
    empty_fraction: false,
};

/// Decimal text to integer cents without floats.
pub fn parse_amount(text: &str, style: AmountStyle) -> Result<Cents, AmountError> {
    let rules = match style {
        AmountStyle::Ofx => OFX,
        AmountStyle::Csv => CSV,
    };
    let (negative, rest) = if let Some(rest) = text.strip_prefix('-') {
        (
            true,
            rules
                .dollar
                .then(|| rest.strip_prefix('$'))
                .flatten()
                .unwrap_or(rest),
        )
    } else if let Some(rest) = text.strip_prefix("$-").filter(|_| rules.dollar) {
        (true, rest)
    } else {
        let rest = text
            .strip_prefix('+')
            .filter(|_| rules.plus)
            .unwrap_or(text);
        (
            false,
            rules
                .dollar
                .then(|| rest.strip_prefix('$'))
                .flatten()
                .unwrap_or(rest),
        )
    };
    let (whole, fraction, has_mark) = match rest.split_once(rules.marks) {
        Some((whole, fraction)) => (whole, fraction, true),
        None => (rest, "", false),
    };
    let digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    if !digits(whole)
        || !digits(fraction)
        || (whole.is_empty() && !(rules.empty_whole && !fraction.is_empty()))
        || (has_mark && fraction.is_empty() && !rules.empty_fraction)
        || fraction.len() > rules.max_fraction
    {
        return Err(AmountError::NotAnAmount);
    }
    let (fraction, beyond_cents) = fraction.split_at(fraction.len().min(2));
    if beyond_cents.bytes().any(|b| b != b'0') {
        return Err(AmountError::NotWholeCents);
    }
    let whole: i64 = if whole.is_empty() {
        0
    } else {
        whole.parse().map_err(|_| AmountError::NotAnAmount)?
    };
    let fraction: i64 = format!("{fraction:0<2}")
        .parse()
        .map_err(|_| AmountError::NotAnAmount)?;
    // The magnitude is checked first, so i64::MIN is never accepted.
    let total = whole
        .checked_mul(100)
        .and_then(|c| c.checked_add(fraction))
        .map(Cents::new)
        .ok_or(AmountError::NotAnAmount)?;
    if negative {
        total.checked_neg().ok_or(AmountError::NotAnAmount)
    } else {
        Ok(total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use AmountError::{NotAnAmount, NotWholeCents};

    #[test]
    fn ofx_amounts_parse_to_cents_without_floats() {
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
            ("-92233720368547758.07", -i64::MAX),
        ] {
            assert_eq!(
                parse_amount(text, AmountStyle::Ofx),
                Ok(Cents::new(expected)),
                "{text}"
            );
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
            "-92233720368547758.08",
            "$5",
        ] {
            assert_eq!(
                parse_amount(text, AmountStyle::Ofx),
                Err(NotAnAmount),
                "{text:?}"
            );
        }
    }

    #[test]
    fn csv_amounts_parse_to_cents_without_floats() {
        let ok = [
            ("-18.40000", -1840),
            ("2100.00000", 210_000),
            ("$12.5", 1250),
            ("-$4.25", -425),
            ("$-4.25", -425),
            ("7", 700),
            ("0.10", 10),
            ("-0.00", 0),
            ("92233720368547758.07", i64::MAX),
            ("-92233720368547758.07", -i64::MAX),
        ];
        for (text, expected) in ok {
            assert_eq!(
                parse_amount(text, AmountStyle::Csv),
                Ok(Cents::new(expected)),
                "{text}"
            );
        }
        for text in ["0.00500", "12.345", "0.001"] {
            assert_eq!(
                parse_amount(text, AmountStyle::Csv),
                Err(NotWholeCents),
                "{text}"
            );
        }
        for text in [
            "1,200.00",
            "",
            "$",
            "-",
            ".50",
            "12.",
            "1.000000",
            "+5",
            "--5",
            "5-",
            "1e3",
            "99999999999999999999",
            "92233720368547758.08",
            "-92233720368547758.08",
        ] {
            assert_eq!(
                parse_amount(text, AmountStyle::Csv),
                Err(NotAnAmount),
                "{text}"
            );
        }
    }
}
