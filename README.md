# Accordatore

Webapp statica per accordare strumenti tramite microfono. Include preset per chitarra, basso, ukulele e modalità cromatica.

## Avvio locale

Per aprirla nel browser:

```bash
python3 -m http.server 5173
```

Poi visita `http://localhost:5173`.

Il microfono richiede un contesto sicuro: `localhost` è supportato dai browser moderni. Se apri direttamente `index.html`, alcuni browser potrebbero bloccare l'accesso al microfono.

## Funzioni

- Rilevamento frequenza in tempo reale con Web Audio API.
- Indicatore in centesimi per capire se la nota è bassa, intonata o alta.
- Calibrazione del La centrale tra 400 e 480 Hz.
- Tono di prova per controllare rapidamente la risposta dell'interfaccia.
