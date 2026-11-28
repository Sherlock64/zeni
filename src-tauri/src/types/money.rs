use std::fmt;

use serde::{Deserialize, Serialize};

/// An amount of money in integer cents. The field is private and there are no operator impls,
/// so every sum, difference or negation goes through a checked op that reports overflow.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
#[derive(sqlx::Type)]
#[sqlx(transparent)]
pub struct Cents(i64);

impl Cents {
    pub const fn new(cents: i64) -> Cents {
        Cents(cents)
    }

    pub const fn get(self) -> i64 {
        self.0
    }

    pub fn checked_neg(self) -> Option<Cents> {
        self.0.checked_neg().map(Cents)
    }

    pub fn checked_add(self, other: Cents) -> Option<Cents> {
        self.0.checked_add(other.0).map(Cents)
    }

    pub fn checked_sub(self, other: Cents) -> Option<Cents> {
        self.0.checked_sub(other.0).map(Cents)
    }

    /// The sum of all amounts; `None` on overflow.
    pub fn checked_sum(amounts: impl IntoIterator<Item = Cents>) -> Option<Cents> {
        amounts
            .into_iter()
            .try_fold(Cents(0), |total, amount| total.checked_add(amount))
    }
}

/// `-12.34`, `12.00`, `0.00`.
impl fmt::Display for Cents {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let magnitude = self.0.unsigned_abs();
        let sign = if self.0 < 0 { "-" } else { "" };
        write!(f, "{sign}{}.{:02}", magnitude / 100, magnitude % 100)
    }
}

/// Which source's amount text rules apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmountStyle {
    Ofx,
    Csv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmountError {
    NotAnAmount,
    NotWholeCents,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_ops_report_overflow() {
        let max = Cents::new(i64::MAX);
        let min = Cents::new(i64::MIN);
        assert_eq!(max.checked_add(Cents::new(1)), None);
        assert_eq!(
            Cents::new(5).checked_add(Cents::new(-7)),
            Some(Cents::new(-2))
        );
        assert_eq!(min.checked_neg(), None);
        assert_eq!(Cents::new(5).checked_neg(), Some(Cents::new(-5)));
        assert_eq!(min.checked_sub(Cents::new(1)), None);
        assert_eq!(
            Cents::new(5).checked_sub(Cents::new(7)),
            Some(Cents::new(-2))
        );
        assert_eq!(
            Cents::checked_sum([Cents::new(100), Cents::new(-250)]),
            Some(Cents::new(-150))
        );
        assert_eq!(Cents::checked_sum([]), Some(Cents::new(0)));
        assert_eq!(Cents::checked_sum([max, Cents::new(1)]), None);
    }

    #[test]
    fn display_shows_dollars_and_cents() {
        for (cents, text) in [
            (-1234, "-12.34"),
            (1200, "12.00"),
            (0, "0.00"),
            (-5, "-0.05"),
            (i64::MIN, "-92233720368547758.08"),
            (i64::MAX, "92233720368547758.07"),
        ] {
            assert_eq!(Cents::new(cents).to_string(), text);
        }
    }
}
