# Accordatore

Webapp statica per accordare strumenti tramite microfono. Include preset per chitarra, basso, ukulele e modalità cromatica.

## Avvio locale

Per aprirla nel browser:

```bash
python3 -m http.server 5173
```

Poi visita `http://localhost:5173`.

Il microfono richiede un contesto sicuro: `localhost` è supportato dai browser moderni. Se apri direttamente `index.html`, alcuni browser potrebbero bloccare l'accesso al microfono.

## Test

Per verificare il motore di rilevamento con sinusoidi sintetiche:

```bash
node tests/audio-engine.test.js
```

## iPhone

La webapp include manifest, icona Home, meta Apple per apertura standalone e service worker.

Per salvarla come app:

1. Aprila da Safari.
2. Usa Condividi.
3. Scegli Aggiungi alla schermata Home.

Se l'avevi gia salvata prima di questi file, rimuovi l'icona vecchia e aggiungila di nuovo. iOS mantiene le impostazioni del collegamento creato in precedenza.

Su iPhone il microfono funziona correttamente solo da un contesto sicuro, quindi in produzione usa HTTPS.

## Funzioni

- Rilevamento frequenza in tempo reale con Web Audio API.
- Test sintetico su note basse e medie per ridurre regressioni nel motore audio.
- Grafico verticale dell'intonazione nel tempo, con pause vuote quando non c'è segnale.
- Valore dei centesimi vicino al punto rilevato.
- Paletta centrale sovrapposta al grafico, con note in italiano e corda evidenziata dopo una breve conferma del rilevamento.
- Skin UI selezionabile: Brutal, Neon o Pixel.
- Calibrazione del La centrale tra 400 e 480 Hz.
