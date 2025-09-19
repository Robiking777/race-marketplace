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
