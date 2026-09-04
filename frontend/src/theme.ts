import {
  Badge,
  Button,
  Container,
  createTheme,
  Paper,
  rem,
  Tabs,
  TextInput,
} from "@mantine/core"

/**
 * Theme for a beamline control panel.
 *
 * Two things drive every choice here: the screen is read from a metre away in
 * a lit room, and a mistaken click moves real hardware. So type is large,
 * targets are large, and the accent colour is reserved for the controls that
 * actually do something.
 */
/** Comfortable measure for a control panel: wide enough for the chart, not so
 *  wide that a row of buttons stretches across a metre of screen. */
export const CONTENT_WIDTH = 1120

/** The one button footprint used across the app. */
export const BUTTON_WIDTH = 156
export const BUTTON_HEIGHT = 46

export const theme = createTheme({
  primaryColor: "blue",
  primaryShade: 7,
  defaultRadius: "md",

  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: '"Geist Mono Variable", ui-monospace, SFMono-Regular, monospace',
  headings: { fontWeight: "600" },

  // Still a touch larger than Mantine's defaults, for reading at arm's length.
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(15),
    lg: rem(16),
    xl: rem(19),
  },
  lineHeights: { md: "1.55" },
  spacing: { xs: rem(10), sm: rem(14), md: rem(20), lg: rem(28), xl: rem(40) },

  components: {
    Button: Button.extend({
      // Every command button is the same target, so none is easier to hit by
      // accident than another and the control surface reads as one row.
      defaultProps: { size: "md", radius: "md", w: BUTTON_WIDTH, h: BUTTON_HEIGHT },
    }),
    TextInput: TextInput.extend({
      defaultProps: { size: "md" },
    }),
    Tabs: Tabs.extend({
      defaultProps: { variant: "default" },
    }),
    Paper: Paper.extend({
      defaultProps: { radius: "lg" },
    }),
    Badge: Badge.extend({
      // Names like "2 cm" and "Not set up" are read as words, not shouted.
      styles: { label: { textTransform: "none" } },
    }),
    Container: Container.extend({
      defaultProps: { size: CONTENT_WIDTH },
    }),
  },
})
