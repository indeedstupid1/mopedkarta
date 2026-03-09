# MoppeKart

En snabb frontend for att hitta korbara rutter for:

- Moped klass 1
- Moped klass 2
- A-traktor / EPA

## Funktioner

- Nuvarande plats eller specifik startadress
- Exakt adressinmatning med Enter-stod och sokforslag
- Kartval med clean, standard och satellit
- Filtrering av vagar beroende pa fordonstyp
- Cykelvagar for klass 2
- Maxhastighet valbar upp till 100 km/h
- Tydlig mobilvy med fullskarmskarta och bottenpanel
- Beraknad restid utifran vald maxhastighet, vagtyp och hastighetsbegransningar
- Klara felmeddelanden nar ingen rutt kan raknas fram

## Teknik

- HTML, CSS och vanilla JavaScript
- [Leaflet](https://leafletjs.com/) for kartan
- [OpenStreetMap](https://www.openstreetmap.org/) for kartdata
- [Nominatim](https://nominatim.openstreetmap.org/) for platssok
- [Overpass API](https://overpass-api.de/) for att hamta korbara vagsegment
- [Esri World Imagery](https://www.esri.com/) for satellitlager

## Kor lokalt

Starta helst en enkel lokal server i mappen och oppna appen via `http://localhost` sa att platsatkomst fungerar stabilt. Om du vill kan du ocksa prova att oppna [index.html](./index.html) direkt, men vissa webblasare blockerar geolocation da.

For bast resultat:

- Starta till exempel `python -m http.server 8000` i mappen och ga till `http://localhost:8000`
- Tillat platsatkomst i webblasaren
- Testa i en modern Chromium- eller Firefox-baserad webblasare
- Hall rutterna till rimliga mopedavstand eftersom rutten byggs i klienten
