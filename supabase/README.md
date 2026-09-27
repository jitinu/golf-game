# Supabase API

The API is a plain `Request` router in the `api` Edge Function. It uses the
service-role key and keeps all tables inaccessible to anonymous clients through
Row Level Security.

```sh
supabase db push
supabase secrets set TURNSTILE_SECRET=your-turnstile-secret
supabase functions deploy api --no-verify-jwt
```

`TURNSTILE_SECRET` is optional. When configured, finishing a run also verifies
the submitted Turnstile token.
