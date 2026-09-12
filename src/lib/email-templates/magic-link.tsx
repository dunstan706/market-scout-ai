import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, paragraph } from './brand-email'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <BrandEmail preview={`Your ${siteName} sign-in link`} heading="Here to read your brief?" action={{ label: 'Sign in', url: confirmationUrl }} footer="This link expires shortly. If you weren't expecting it, ignore this email.">
    <Text style={paragraph}>Use the button below to sign in to {siteName} — no password needed.</Text>
  </BrandEmail>
)

export default MagicLinkEmail

