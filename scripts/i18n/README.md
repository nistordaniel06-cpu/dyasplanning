# Traducerea în engleză

Textele din aplicație sunt scrise în română. Dicționarul `public/i18n-en.json` le traduce în engleză
(îl folosesc și aplicația, și service worker-ul pentru notificările pe telefon).

Când adaugi texte noi:

```bash
node scripts/i18n/extract.cjs     # strânge textele din src/ în scripts/i18n/strings.json
python3 scripts/i18n/build.py     # reface public/i18n-en.json și afișează câte texte nu au traducere
```

Traducerile se scriu în `exact1.py` / `exact2.py` (text exact) sau în `build.py` (texte cu nume și cifre, ca expresii regulate).
