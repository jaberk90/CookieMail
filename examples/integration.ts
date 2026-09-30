import express, { type Express, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  createCookieMail,
  type MailProvider,
  type MailStore,
  type Operator,
} from '../src/index.js';

/** Pass verified host identities; never read role/identity from request bodies. */
export function mountMail(
  app: Express,
  options: {
    store: MailStore;
    provider: MailProvider;
    origin: string;
    authenticate: (req: Request) => Promise<Operator | null>;
    verifySignup: (req: Request) => Promise<boolean>;
  },
) {
  const mail = createCookieMail({
    store: options.store,
    provider: options.provider,
    auth: options.authenticate,
    publicOrigin: options.origin,
    publicBasePath: '/mail-public',
    brand: 'Your company',
    logger: console,
  });
  app.use('/api/mail', mail.router);
  app.use('/mail-public', mail.publicRouter);
  app.post(
    '/subscribe',
    rateLimit({ windowMs: 60000, limit: 5 }),
    express.json({ limit: '4kb' }),
    async (req, res) => {
      if (
        (req.get('Origin') && req.get('Origin') !== options.origin) ||
        req.get('Sec-Fetch-Site') === 'cross-site' ||
        !req.is('application/json')
      ) {
        res.sendStatus(403);
        return;
      }
      if (!(await options.verifySignup(req))) {
        res.sendStatus(403);
        return;
      }
      try {
        // Explicit allowlist: the visitor must not choose tags or privilege-like metadata.
        await mail.subscribe({
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          email: req.body.email,
          consent: req.body.consent,
          source: 'website-newsletter',
          tags: ['Newsletter'],
        });
        res.json({ ok: true });
      } catch {
        res.status(400).json({ error: 'Unable to subscribe. Check your details or contact us.' });
      }
    },
  );
  return mail; // scheduler invokes mail.flush(10); your lifecycle invokes mail.close()
}
