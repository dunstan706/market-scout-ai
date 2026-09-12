import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, paragraph } from './brand-email'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <BrandEmail preview={`Confirm your email change — ${siteName}`} heading="Confirm your new email" action={{ label: 'Confirm email change', url: confirmationUrl }} footer="If you didn't request this change, secure your account immediately.">
    <Text style={paragraph}>You requested to change your {siteName} email from {oldEmail} to {newEmail}.</Text>
  </BrandEmail>
)

export default EmailChangeEmail

