import * as React from 'react'

import { Text } from '@react-email/components'
import { BrandEmail, code, paragraph } from './brand-email'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <BrandEmail preview="Your theBizScope verification code" heading="Confirm it’s you" footer="This code expires shortly. If you didn't request it, ignore this email.">
    <Text style={paragraph}>Use this code to confirm your identity:</Text>
    <Text style={code}>{token}</Text>
  </BrandEmail>
)

export default ReauthenticationEmail

