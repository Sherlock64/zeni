//! The app version and strict `major.minor.patch` parsing; compare parsed versions as tuples.

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// `Some((major, minor, patch))` for exactly three dot-separated decimal parts, else `None`.
pub fn parse(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split('.').map(|part| {
        // `u64::from_str` accepts a leading `+`, so check the digits first.
        (!part.is_empty() && part.bytes().all(|c| c.is_ascii_digit()))
            .then(|| part.parse().ok())
            .flatten()
    });
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_parses() {
        assert!(parse(APP_VERSION).is_some(), "{APP_VERSION}");
    }

    #[test]
    fn package_json_version_matches_cargo() {
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(package["version"], env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn parses_only_three_decimal_parts() {
        assert_eq!(parse("7.0.0"), Some((7, 0, 0)));
        assert_eq!(parse("7.10.0"), Some((7, 10, 0)));
        for text in [
            "7",
            "7.1",
            "7.0.0-rc1",
            "v7.0.0",
            "",
            "7.0.x",
            "7.0.0.1",
            "7..0",
            "+7.0.0",
            "7.0.0 ",
        ] {
            assert_eq!(parse(text), None, "{text:?}");
        }
    }

    #[test]
    fn orders_as_tuples() {
        let v = |text| parse(text).unwrap();
        assert!(v("7.10.0") > v("7.9.0"));
        assert!(v("7.9.0") > v("7.0.1"));
        assert!(v("7.0.1") > v("7.0.0"));
    }
}
