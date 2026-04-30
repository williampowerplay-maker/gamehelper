import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Crimson Desert Guide",
  description: "Terms of Service for Crimson Desert Guide.",
};

export default function TermsOfService() {
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
          Terms of Service
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginBottom: "2.5rem" }}>
          Last updated: April 15, 2026
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using Crimson Desert Guide (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do
            not agree, do not use the Service.
          </p>
          <p>
            We reserve the right to modify these Terms at any time. Continued use of the Service
            after changes are posted constitutes acceptance of the updated Terms.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            Crimson Desert Guide is an AI-powered game companion for the video game{" "}
            <em>Crimson Desert</em> (developed by Pearl Abyss). The Service allows users to ask
            questions about in-game content and receive AI-generated answers based on a curated
            knowledge base of wiki content and game guides.
          </p>
          <p>
            Crimson Desert Guide is an independent fan project and is not affiliated with, endorsed
            by, or officially connected to Pearl Abyss.
          </p>
        </Section>

        <Section title="3. User Accounts">
          <p>
            You may use the Service without an account (as a free-tier guest) or create an account
            for additional features. By creating an account you agree to:
          </p>
          <ul>
            <li>Provide accurate registration information.</li>
            <li>Keep your password secure and not share it with others.</li>
            <li>Notify us immediately of any unauthorised access to your account.</li>
            <li>Be responsible for all activity that occurs under your account.</li>
          </ul>
          <p>
            You must be at least 13 years old to create an account. By creating an account, you
            represent that you meet this requirement.
          </p>
        </Section>

        <Section title="4. Acceptable Use">
          <p>You agree not to:</p>
          <ul>
            <li>
              Use the Service for any unlawful purpose or in violation of any applicable laws or
              regulations.
            </li>
            <li>
              Attempt to circumvent rate limits, abuse the AI pipeline, or send automated or
              scripted requests at volumes that harm the Service for other users.
            </li>
            <li>
              Submit questions containing personal data of third parties, malicious code, hate
              speech, or other harmful content.
            </li>
            <li>
              Reverse engineer, decompile, or attempt to extract the source code of any part of
              the Service (beyond what is publicly available in the GitHub repository).
            </li>
            <li>
              Resell or commercialise access to the Service without our prior written consent.
            </li>
          </ul>
          <p>
            We reserve the right to suspend or terminate accounts that violate these rules at our
            sole discretion.
          </p>
        </Section>

        <Section title="5. Premium Subscriptions">
          <p>
            The Service offers a premium subscription tier ("Premium") that provides higher rate
            limits and an ad-free experience.
          </p>
          <ul>
            <li>
              <strong>Billing</strong> — Premium is billed monthly at the rate displayed at the
              time of purchase. Prices may change with 30 days' notice.
            </li>
            <li>
              <strong>Cancellation</strong> — You may cancel your subscription at any time.
              Cancellation takes effect at the end of the current billing period; no partial refunds
              are issued for unused time.
            </li>
            <li>
              <strong>Refunds</strong> — Refunds are issued at our discretion. Contact us within
              7 days of a charge if you believe you were billed in error.
            </li>
            <li>
              <strong>Changes to Premium</strong> — We reserve the right to modify the features
              included in Premium with reasonable notice.
            </li>
          </ul>
        </Section>

        <Section title="6. AI-Generated Content Disclaimer">
          <p>
            Answers provided by the Service are generated by an AI language model (Claude by
            Anthropic) based on a knowledge base of third-party wiki and guide content. We make no
            guarantees that any answer is accurate, complete, or up to date.
          </p>
          <ul>
            <li>Game content changes with patches — our knowledge base may lag behind.</li>
            <li>The AI may occasionally produce incorrect or misleading answers.</li>
            <li>Always verify critical information against official sources if precision matters.</li>
          </ul>
          <p>
            You rely on AI-generated answers at your own risk. We are not liable for any in-game
            decisions made based on information provided by the Service.
          </p>
        </Section>

        <Section title="7. Intellectual Property">
          <SubHeading>7.1 Game content</SubHeading>
          <p>
            All game content, characters, artwork, lore, and materials related to Crimson Desert
            are the intellectual property of Pearl Abyss Co., Ltd. Crimson Desert Guide does not
            claim ownership of any game content. Our knowledge base is assembled from publicly
            available community wikis and guides for informational and fan purposes.
          </p>
          <SubHeading>7.2 Service content</SubHeading>
          <p>
            The software, design, and non-game content of this Service are owned by us. You may
            not copy, reproduce, or distribute them without our written permission.
          </p>
        </Section>

        <Section title="8. Advertising">
          <p>
            Free-tier users may see advertisements served by Google AdSense. By using the Service
            as a free-tier user, you acknowledge and consent to the display of these ads. Premium
            users see no advertisements.
          </p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>
            To the maximum extent permitted by applicable law, Crimson Desert Guide and its
            operators are not liable for any indirect, incidental, special, consequential, or
            punitive damages arising out of your use of or inability to use the Service, even if
            we have been advised of the possibility of such damages.
          </p>
          <p>
            Our total liability to you for any claim arising from these Terms or your use of the
            Service shall not exceed the amount you paid us in the 12 months preceding the claim,
            or $10 USD, whichever is greater.
          </p>
        </Section>

        <Section title="10. Disclaimer of Warranties">
          <p>
            The Service is provided <strong>"as is"</strong> and <strong>"as available"</strong>{" "}
            without warranties of any kind, either express or implied, including but not limited to
            implied warranties of merchantability, fitness for a particular purpose, and
            non-infringement. We do not warrant that the Service will be uninterrupted, error-free,
            or free of viruses or other harmful components.
          </p>
        </Section>

        <Section title="11. Governing Law">
          <p>
            These Terms are governed by and construed in accordance with applicable law. Any
            disputes shall be resolved through good-faith negotiation first; if unresolved, through
            binding arbitration or a court of competent jurisdiction.
          </p>
        </Section>

        <Section title="12. Termination">
          <p>
            We may suspend or terminate your access to the Service at any time for any reason,
            including violation of these Terms, with or without notice. You may stop using the
            Service and delete your account at any time.
          </p>
          <p>
            Sections 6 (AI disclaimer), 7 (IP), 9 (liability), and 10 (warranties) survive
            termination.
          </p>
        </Section>

        <Section title="13. Contact">
          <p>
            Questions about these Terms? Email us at{" "}
            <strong>legal@crimsondesertguide.com</strong>.
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
