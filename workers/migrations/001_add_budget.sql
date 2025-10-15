-- Migration: Add budget column to trips table
-- Date: 2025-10-15

ALTER TABLE trips ADD COLUMN budget TEXT;

