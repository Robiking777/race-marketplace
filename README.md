# Marketplace pakietów startowych (MVP)

To repo jest gotowe do publikacji na Vercel/Netlify.
- Dev: `npm install` → `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

Stack: Vite + React + TailwindCSS. Dane są w localStorage przeglądarki.

## Nowe funkcje: alerty i powiadomienia

- Użytkownik może tworzyć alerty w profilu (zakładka **Alerty**). Alerty pozwalają filtrować po typie ogłoszenia, biegu/roku,
  dystansie i maksymalnej cenie oraz opcjonalnie wysyłać powiadomienia e-mail.
- Po zapisaniu lub edycji ogłoszenia dane są wysyłane do Supabase (`/api/alerts-fanout`), co uruchamia fan-out powiadomień do
  użytkowników z pasującymi alertami.
- W nagłówku dodano dzwonek z listą ostatnich powiadomień. Kliknięcie elementu oznacza go jako przeczytany.

## Konfiguracja Supabase

1. W Supabase uruchom kolejno migracje z katalogu `supabase/migrations` (jeśli jeszcze nie były stosowane).
2. Następnie uruchom skrypt `supabase/alerts.sql` w edytorze SQL, aby dodać tabele `listings`, `alerts`, `notifications`, widok
   `alerts_match` oraz kolumnę `email_notifications` w tabeli `profiles`.

Wymagane zmienne środowiskowe (Vercel):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE` – używane w funkcji `api/alerts-fanout.js` do zapisu w bazie i wyszukiwania alertów.
- `RESEND_API_KEY` – klucz API do wysyłki e-maili (np. Resend). Opcjonalnie można ustawić `RESEND_FROM` (nadpisuje nadawcę
  wiadomości, domyślnie `Race Marketplace <alerts@example.com>`).

> Upewnij się, że w tabeli `profiles` istnieje polityka pozwalająca użytkownikowi aktualizować własne rekordy (wymagane do
> zmiany zgody na powiadomienia e-mail).

## Lokalne uruchomienie

- Dev: `npm install` → `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`

## Jak uruchomić scraper kalendarza biegów

Skrypt `scripts/scrape-maratonypolskie.js` pobiera wydarzenia biegowe z kalendarza Maratonypolskie.pl w zakresie od
1.10.2025 do 31.12.2026 i uzupełnia tabele `events` oraz `event_editions` w Supabase.

1. Skonfiguruj zmienne środowiskowe (lokalnie w `.env.local` lub na Vercel w **Project → Settings → Environment Variables**):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE`
   - `SCRAPER_SECRET` – wymagany przy wywoływaniu endpointu HTTP `/api/run-scraper`.
2. Zainstaluj zależności: `npm install`.
3. Uruchom scraper: `npm run scrape:mp`.

Skrypt wysyła żądania co ok. 800 ms z nagłówkiem `User-Agent: RaceMarketplaceBot/1.0 (contact: admin@racemarketplace.pl)` i
wykonuje idempotentne upserty – wielokrotne uruchomienie nie duplikuje danych. W logach znajdziesz liczbę przetworzonych
stron, wpisów oraz statystyki upsertów.

### Endpoint `/api/run-scraper`

Po wdrożeniu na Vercel możesz uruchamiać scraper w krótkich turach poprzez endpoint `/api/run-scraper`. Endpoint jest
chroniony parametrem `key=<SCRAPER_SECRET>` i przyjmuje następujące parametry zapytania (GET/POST):

- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `cursor=<int>` (opcjonalnie – numer strony, od której kontynuujemy)
- `budgetMs=<int>` (opcjonalnie – budżet czasowy w milisekundach, domyślnie 45000)

Przykład jednego wywołania:

```
/api/run-scraper?from=2025-10-01&to=2025-10-31&key=TWÓJ_SEKRET
```

Odpowiedź zawiera liczbę przetworzonych wpisów (`seen`), liczbę dodanych edycji (`inserted`) oraz informacje o tym, czy
zakres został ukończony (`done`). Jeśli `done` jest `false`, a pole `cursor` ma wartość np. `3`, kontynuuj okno dodając do
zapytania `&cursor=3`. Możesz także dostosować budżet czasu np. `&budgetMs=30000`. Wywołuj scraper miesiąc po miesiącu,
aby zmieścić się w limicie 60 s funkcji serverless (np. październik 2025, listopad 2025, grudzień 2025 itd.).

### Scraper – kolizje slugów

- Podczas wyszukiwania wydarzenia scraper porównuje nazwę i miasto case-insensitive, więc ponowne uruchomienie nie duplikuje
  rekordów.
- Slugi są budowane z nazwy oraz miasta (np. `bieg-niepodleglosci-warszawa`). Jeśli slug jest zajęty, kolejne próby dodają
  sufiks `-2`, `-3`, ... – informacja o kolizji pojawia się w logu (`[scraper] slug collision for ...`).
- Wstawianie rekordu ponawia się w razie konfliktu klucza unikalnego, by zachować idempotentność nawet przy równoległym
  uruchomieniu.

### Integracja z Vercel Cron (opcjonalnie)

Repozytorium zawiera plik `vercel.json` oraz endpoint `api/run-scraper.js`. Po wdrożeniu na Vercel cron raz w tygodniu
(poniedziałek, godz. 03:00 UTC) wywoła `GET /api/run-scraper` (pamiętaj o ustawieniu `SCRAPER_SECRET`). W razie potrzeby
możesz zmienić harmonogram lub wywołać endpoint ręcznie (np. `POST /api/run-scraper`) – pamiętaj o podaniu parametrów
`from`, `to`, `key`, a w razie potrzeby także `cursor`/`budgetMs`.
