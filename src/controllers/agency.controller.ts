import { Request, Response } from 'express';
import { AgencySettings } from '../models/AgencySettings';

export const getAgencySettings = async (req: Request, res: Response) => {
  try {
    let settings = await AgencySettings.findOne();
    if (!settings) {
      settings = await AgencySettings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

export const updateAgencySettings = async (req: Request, res: Response) => {
  try {
    const settings = await AgencySettings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
