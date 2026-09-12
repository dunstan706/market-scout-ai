import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, paragraph } from './brand-email'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <BrandEmail
    preview={`Confirm your email — ${siteName}`}
    heading="One click and your market watch begins."
    action={{ label: 'Confirm my email', url: confirmationUrl }}
    footer={`This link works once and expires shortly. If you didn't create a ${siteName} account for ${recipient}, ignore this email — nothing else happens.`}
  >
    <Text style={paragraph}>
      Confirm your email to activate your account. Your weekly brief will show what changed nearby, why it matters, and what to do next.
    </Text>
    <Text style={paragraph}>You can return to {siteUrl} whenever you’re ready.</Text>
  </BrandEmail>
)

export default SignupEmail

