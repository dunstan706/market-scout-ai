import * as React from 'react'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components'

type BrandEmailProps = {
  preview: string
  heading: string
  children: React.ReactNode
  action?: { label: string; url: string }
  footer: string
}

export function BrandEmail({ preview, heading, children, action, footer }: BrandEmailProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={brand}>theBizScope</Text>
          <Heading style={headingStyle}>{heading}</Heading>
          <Section style={content}>{children}</Section>
          {action ? (
            <Button style={button} href={action.url}>
              {action.label}
            </Button>
          ) : null}
          <Text style={footerStyle}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const paragraph = {
  color: '#44403c',
  fontFamily: 'Arial, sans-serif',
  fontSize: '15px',
  lineHeight: '1.65',
  margin: '0 0 20px',
}

export const code = {
  backgroundColor: '#F5F0E6',
  border: '1px solid #D6D3D1',
  color: '#1C1917',
  fontFamily: 'Courier, monospace',
  fontSize: '24px',
  fontWeight: 'bold' as const,
  letterSpacing: '6px',
  margin: '8px 0 24px',
  padding: '16px',
  textAlign: 'center' as const,
}

const body = { backgroundColor: '#ffffff', margin: '0', padding: '24px 12px' }
const container = {
  border: '1px solid #E7E5E4',
  borderRadius: '4px',
  margin: '0 auto',
  maxWidth: '520px',
  padding: '34px 30px',
}
const brand = {
  color: '#B45309',
  fontFamily: 'Arial, sans-serif',
  fontSize: '12px',
  fontWeight: 'bold' as const,
  letterSpacing: '1.5px',
  margin: '0 0 16px',
  textTransform: 'uppercase' as const,
}
const headingStyle = {
  color: '#1C1917',
  fontFamily: 'Georgia, Times New Roman, serif',
  fontSize: '26px',
  fontWeight: 'normal' as const,
  lineHeight: '1.25',
  margin: '0 0 18px',
}
const content = { margin: '0' }
const button = {
  backgroundColor: '#B45309',
  borderRadius: '4px',
  color: '#ffffff',
  fontFamily: 'Arial, sans-serif',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  margin: '4px 0 0',
  padding: '12px 24px',
  textDecoration: 'none',
}
const footerStyle = {
  borderTop: '1px solid #E7E5E4',
  color: '#78716C',
  fontFamily: 'Arial, sans-serif',
  fontSize: '12px',
  lineHeight: '1.6',
  margin: '30px 0 0',
  paddingTop: '18px',
}