import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface MagicLinkEmailProps {
  signInUrl: string;
  recipientName?: string;
  productName?: string;
}

export function MagicLinkEmail({
  signInUrl,
  recipientName,
  productName = 'ArchThread',
}: MagicLinkEmailProps) {
  const name = recipientName?.trim();
  return (
    <Html lang="en">
      <Head />
      <Preview>Your secure sign-in link for {productName}</Preview>
      <Body style={{ backgroundColor: '#f3f6f4', fontFamily: 'Arial, sans-serif', margin: 0, padding: '32px 12px' }}>
        <Container style={{ backgroundColor: '#ffffff', border: '1px solid #dce6df', borderRadius: 14, maxWidth: 520, padding: 32 }}>
          <Section>
            <Text style={{ color: '#247357', fontSize: 13, fontWeight: 700, letterSpacing: 1.4, margin: '0 0 20px', textTransform: 'uppercase' }}>
              {productName}
            </Text>
            <Heading style={{ color: '#10231b', fontSize: 25, lineHeight: '32px', margin: '0 0 12px' }}>
              Sign in securely
            </Heading>
            <Text style={{ color: '#52645a', fontSize: 15, lineHeight: '24px', margin: '0 0 24px' }}>
              {name ? `Hi ${name}, use the button below` : 'Use the button below'} to sign in. This link expires in 15 minutes and can only be used once.
            </Text>
            <Button
              href={signInUrl}
              style={{ backgroundColor: '#247357', borderRadius: 8, color: '#ffffff', display: 'inline-block', fontSize: 15, fontWeight: 700, padding: '13px 20px', textDecoration: 'none' }}
            >
              Sign in to {productName}
            </Button>
            <Text style={{ color: '#69786f', fontSize: 12, lineHeight: '19px', margin: '24px 0 0' }}>
              If you did not request this email, you can safely ignore it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
