import { SubscribeForm } from '../src/react.js'; // In your app: from 'cookiemail/react'
/** Place this component in your shared Layout so it appears on every page. */
export function FooterSignup({ theme = 'dark' }: { theme?: 'dark' | 'light' }) {
  return (
    <footer className="cm-signup-footer" data-theme={theme}>
      <div className="cm-signup-copy">
        <span className="cm-signup-label">LET’S KEEP IN TOUCH</span>
        <h2>
          A few good things.
          <br />
          Straight to your inbox.
        </h2>
        <p>
          Fresh ideas, product news and the occasional little surprise. Thoughtfully sent. Always
          easy to leave.
        </p>
        <span className="cm-signup-mark">✦ CookieMail</span>
      </div>
      <div className="cm-signup-card">
        <h3>Make a little room for inspiration.</h3>
        <SubscribeForm action="/subscribe" label="Count me in →" />
        <p className="cm-signup-fine">
          We only send what you signed up for. Every email includes an unsubscribe link.
        </p>
      </div>
    </footer>
  );
}
