# SubSentry: E-Commerce Subscription Trap Detector

## Overview
SubSentry is an experimental text analysis application that uses
zero-shot classification to compare subscription terms with
five subscription-related categories.

## Categories
- Automatic subscription renewal
- Free trial converting into a paid subscription
- Hidden or unclear fees
- Difficult cancellation policy
- Clear subscription terms

## Technology Stack
- HTML, CSS and JavaScript
- Netlify Functions
- Hugging Face Inference Providers
- facebook/bart-large-mnli

## How It Works
Users paste subscription-related text into the website.
A serverless function sends the text and candidate categories
to a pretrained model and returns ranked classification scores.

## Limitations
The output scores are model classification scores, not calibrated
probabilities of fraud. Predictions may be incorrect and should
not be treated as legal conclusions.

## Deployment
The static frontend and serverless function are deployed through
Netlify. The model is accessed through the Hugging Face API.

## Academic Project
This application is an educational prototype, not a verified
consumer-protection or fraud-detection service.
