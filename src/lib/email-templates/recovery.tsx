import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, paragraph } from './brand-email'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <BrandEmail preview={`Reset your ${siteName} password`} heading="Reset your password" action={{ label: 'Choose a new password', url: confirmationUrl }} footer="If you didn't request this, ignore this email. Your password will not change.">
    <Text style={paragraph}>We received a request to reset the password for your {siteName} account.</Text>
  </BrandEmail>
)

export default RecoveryEmail

