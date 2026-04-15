import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Crimson Desert Guide",
  description: "Privacy Policy for Crimson Desert Guide — how we collect and use your data.",
};

export default function PrivacyPolicy() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        backgroundColor: "var(--color-dark-bg)",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>

        {/* Back link */}
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            color: "var(--color-crimson)",
            textDecoration: "none",
            fontSize: "0.875rem",
            marginBottom: "2rem",
          }}
        >
          ← Back to Guide
        </Link>

        {/* Header */}
        <h1 style={{ fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Privacy Policy
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginBottom: "2.5rem" }}>
          Last updated: April 15, 2026
        </p>

        <Section title="1. Overview">
          <p>
            Crimson Desert Guide ("we", "us", or "our") operates{" "}
            <strong>crimson-guide.vercel.app</strong> (the "Service"). This Privacy Policy explains
            what information we collect, how we use it, and your rights regarding that information.
          </p>
          <p>
            By using the Service you agree to the practices described here. If you do not agree,
            please stop using the Service.
          </p>
        </Section>

        <Section title="2. Information We Collect">
          <SubHeading>2.1 Information you provide</SubHeading>
          <ul>
            <li><strong>Email address</strong> — when you create an account.</li>
            <li><strong>Google account info</strong> — name and email, if you sign in with Google OAuth.</li>
          </ul>

          <SubHeading>2.2 Information collected automatically</SubHeading>
          <ul>
            <li>
              <strong>Questions you ask</strong> — every query submitted to the Service is stored in
              our database. This includes the question text, the spoiler tier selected, and the AI
              response generated.
            </li>
            <li>
              <strong>IP address</strong> — logged with each query for rate-limiting and abuse
              prevention. We do not link IP addresses to user identities for tracking purposes.
            </li>
            <li>
              <strong>Usage data</strong> — daily query counts per account, subscription tier, and
              timestamps.
            </li>
            <li>
              <strong>Error logs</strong> — technical error details (stack traces, request context)
              to help us diagnose and fix problems.
            </li>
          </ul>

          <SubHeading>2.3 Cookies and local storage</SubHeading>
          <p>
            We use cookies required for authentication (Supabase session tokens). If Google AdSense
            is enabled, Google may set additional advertising cookies. See Section 5 for more on
            third-party services.
          </p>
        </Section>

        <Section title="3. How We Use Your Information">
          <ul>
            <li>To answer your in-game questions using our AI pipeline.</li>
            <li>To cache responses and reduce redundant API calls.</li>
            <li>To enforce rate limits and prevent abuse.</li>
            <li>To manage your account and subscription tier.</li>
            <li>To diagnose errors and improve the Service.</li>
            <li>To serve relevant advertisements to free-tier users (via Google AdSense).</li>
          </ul>
          <p>We do not sell your personal information to third parties.</p>
        </Section>

        <Section title="4. Data Retention">
          <ul>
            <li>
              <strong>Cached query responses</strong> are retained for <strong>7 days</strong> and
              then eligible for removal.
            </li>
            <li>
              <strong>Query logs</strong> (question text, IP, tier) are retained for analytics and
              abuse monitoring. You may request deletion — see Section 7.
            </li>
            <li>
              <strong>Account data</strong> is retained for as long as your account is active. You
              may delete your account at any time.
            </li>
            <li>
              <strong>Error logs</strong> are retained for up to 90 days.
            </li>
          </ul>
        </Section>

        <Section title="5. Third-Party Services">
          <p>The Service relies on the following third-party providers, each with their own privacy practices:</p>
          <ul>
            <li>
              <strong>Supabase</strong> — database and authentication hosting. Data is stored on
              Supabase-managed infrastructure.
            </li>
            <li>
              <strong>Anthropic (Claude)</strong> — AI language model used to generate answers.
              Your question and retrieved context are sent to Anthropic's API to produce a response.
            </li>
            <li>
              <strong>Voyage AI</strong> — generates vector embeddings of your questions for
              semantic search. Your question text is sent to Voyage AI's API.
            </li>
            <li>
              <strong>Vercel</strong> — hosting and edge network. Standard server logs apply.
            </li>
            <li>
              <strong>Google AdSense</strong> — advertising shown to free-tier users. Google may
              use cookies and device identifiers to serve personalised ads. You can opt out via
              Google's Ad Settings.
            </li>
            <li>
              <strong>Google OAuth</strong> — optional sign-in method. If used, Google shares
              your name and email address with us.
            </li>
          </ul>
        </Section>

        <Section title="6. Children's Privacy">
          <p>
            The Service is not directed at children under 13. We do not knowingly collect personal
            information from children under 13. If you believe a child has provided us with personal
            information, please contact us and we will delete it.
          </p>
        </Section>

        <Section title="7. Your Rights">
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul>
            <li>Access the personal information we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data ("right to be forgotten").</li>
            <li>Object to or restrict certain processing.</li>
            <li>Data portability (receive your data in a machine-readable format).</li>
          </ul>
          <p>
            To exercise any of these rights, email us at{" "}
            <strong>privacy@crimsondesertguide.com</strong>. We will respond within 30 days.
          </p>
        </Section>

        <Section title="8. Security">
          <p>
            We implement reasonable security measures including HTTPS, security headers (HSTS,
            X-Frame-Options, nosniff), input validation, and row-level security on our database.
            No method of transmission over the internet is 100% secure, and we cannot guarantee
            absolute security.
          </p>
        </Section>

        <Section title="9. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. We will update the "Last updated"
            date at the top of the page. Continued use of the Service after changes constitutes
            acceptance of the revised policy.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about this policy? Email us at{" "}
            <strong>privacy@crimsondesertguide.com</strong>.
          </p>
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2
        style={{
          fontSize: "1.125rem",
          fontWeight: 600,
          color: "var(--color-gold)",
          marginBottom: "0.75rem",
          paddingBottom: "0.375rem",
          borderBottom: "1px solid var(--color-dark-border)",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.625rem",
          color: "var(--color-text-secondary)",
          lineHeight: 1.7,
          fontSize: "0.9375rem",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontWeight: 600, color: "var(--color-text-primary)", marginTop: "0.5rem" }}>
      {children}
    </p>
  );
}
