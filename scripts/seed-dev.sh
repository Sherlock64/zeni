#!/usr/bin/env bash
# Writes a deterministic fake OFX 2.x file of 1,200 transactions (about three years, all before today, invented
# merchants) for the verifier to import through the app. Same bytes on every run.
# Usage: scripts/seed-dev.sh [out.ofx]   (default snapshots/seed-dev.ofx)
set -euo pipefail
out=${1:-snapshots/seed-dev.ofx}
mkdir -p "$(dirname "$out")"
# Dates are computed by hand (fake 28-day months from 2024-01) so the output never depends on awk's strftime.
awk 'BEGIN {
  n = 1200; seed = 12345; split("CORNER GROCERY #112|QUICKFUEL #0412|BEAN THERE CAFE|SHOPMART*ORDER 7741|FITLIFE GYM|STREAMBOX|NORTHWIND UTILITIES|PIZZA PLANET|BOOKNOOK|GREEN LEAF MARKET", m, "|")
  print "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>"
  print "<?OFX OFXHEADER=\"200\" VERSION=\"220\" SECURITY=\"NONE\" OLDFILEUID=\"NONE\" NEWFILEUID=\"NONE\"?>"
  print "<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20260401120000.000</DTSERVER><LANGUAGE>ENG</LANGUAGE><FI><ORG>Example Community Bank</ORG><FID>00000</FID></FI></SONRS></SIGNONMSGSRSV1>"
  print "<BANKMSGSRSV1><STMTTRNRS><TRNUID>0</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><STMTRS><CURDEF>USD</CURDEF>"
  print "<BANKACCTFROM><BANKID>000000000</BANKID><ACCTID>0000000000</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM><BANKTRANLIST><DTSTART>20230101</DTSTART><DTEND>20260331</DTEND>"
  bal = 500000
  for (i = 1; i <= n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    d = int((i - 1) * 1080 / n)                      # 0..1079 fake days
    date = sprintf("%04d%02d%02d", 2023 + int(d / 336), 1 + int(d % 336 / 28), 1 + d % 28)
    if (i % 40 == 0) { amt = 210000; name = "ACME PAYROLL"; type = "CREDIT" }
    else { amt = -(100 + int(seed / 65536) % 9000); name = m[1 + seed % 10]; type = "POS" }
    bal += amt
    printf "<STMTTRN><TRNTYPE>%s</TRNTYPE><DTPOSTED>%s</DTPOSTED><TRNAMT>%.2f</TRNAMT><FITID>SEED%05d</FITID><NAME>%s</NAME><MEMO>Seeded row %d</MEMO></STMTTRN>\n", type, date, amt / 100, i, name, i
  }
  printf "</BANKTRANLIST><LEDGERBAL><BALAMT>%.2f</BALAMT><DTASOF>20260331120000.000</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\n", bal / 100
}' > "$out"
echo "$out"
