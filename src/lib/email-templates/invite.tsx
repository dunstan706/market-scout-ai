import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, paragraph } from './brand-email'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <BrandEmail preview={`You've been invited to ${siteName}`} heading="Your market watch is ready." action={{ label: 'Accept invitation', url: confirmationUrl }} footer="If you weren't expecting this invitation, you can safely ignore this email.">
    <Text style={paragraph}>You’ve been invited to join {siteName}. Accept the invitation to create your account and start watching your local market.</Text>
    <Text style={paragraph}>Visit {siteUrl} to learn more.</Text>
  </BrandEmail>
)

export default InviteEmail

