//! The one parser from amount text to integer cents, shared by the OFX and CSV importers.

use crate::types::{AmountError, AmountStyle, Cents};

pub fn parse_amount(_text: &str, _style: AmountStyle) -> Result<Cents, AmountError> {
    todo!()
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
