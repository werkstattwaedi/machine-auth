import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  SessionWithId,
  UsageSummary,
  MachineUsageSummary,
} from '../models/session.model';

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private firestore = inject(Firestore);

  /**
   * Gets all active (non-closed) sessions for a user
   */
  getActiveSessionsForUser(userId: string): Observable<SessionWithId[]> {
    return from(
      (async () => {
        const sessionsRef = collection(this.firestore, 'sessions');
        const userRef = doc(this.firestore, 'users', userId);

        // Query for sessions where userId matches
        // Note: Can't query for null/missing 'closed' field in Firestore, so filter in code
        const q = query(sessionsRef, where('userId', '==', userRef));

        const querySnapshot = await getDocs(q);

        const sessions: SessionWithId[] = [];
        for (const docSnapshot of querySnapshot.docs) {
          const data = docSnapshot.data();
          // Only include sessions that don't have a 'closed' field
          if (!data['closed']) {
            sessions.push({
              id: docSnapshot.id,
              ...data,
            } as SessionWithId);
          }
        }

        return sessions;
      })()
    );
  }

  /**
   * Closes all active sessions for a user
   */
  async closeAllSessions(
    sessionIds: string[],
    reason: string
  ): Promise<void> {
    const batch = [];

    for (const sessionId of sessionIds) {
      const sessionRef = doc(this.firestore, 'sessions', sessionId);
      batch.push(
        updateDoc(sessionRef, {
          closed: {
            time: serverTimestamp(),
            metadata: JSON.stringify({ reason }),
          },
        })
      );
    }

    await Promise.all(batch);
  }

  /**
   * Calculates usage summary from sessions
   */
  async calculateUsageSummary(
    sessions: SessionWithId[]
  ): Promise<UsageSummary> {
    const machineUsageMap = new Map<string, MachineUsageSummary>();
    let totalDurationMinutes = 0;

    for (const session of sessions) {
      for (const usage of session.usage) {
        // Get machine document to retrieve name
        const machineDoc = await getDoc(usage.machine);
        if (!machineDoc.exists()) {
          console.warn('Machine not found:', usage.machine.id);
          continue;
        }

        const machineData = machineDoc.data();
        const machineId = machineDoc.id;
        const machineName = machineData?.['name'] || 'Unbekannt';

        // Calculate duration if checked out
        let durationMinutes = 0;
        if (usage.checkOut) {
          const checkInTime = usage.checkIn.toDate();
          const checkOutTime = usage.checkOut.toDate();
          const durationMs = checkOutTime.getTime() - checkInTime.getTime();
          durationMinutes = Math.round(durationMs / 1000 / 60);
        }

        // Update machine usage summary
        if (!machineUsageMap.has(machineId)) {
          machineUsageMap.set(machineId, {
            machineId,
            machineName,
            usageCount: 0,
            totalDurationMinutes: 0,
          });
        }

        const machineSummary = machineUsageMap.get(machineId)!;
        machineSummary.usageCount++;
        machineSummary.totalDurationMinutes += durationMinutes;

        totalDurationMinutes += durationMinutes;
      }
    }

    return {
      totalSessions: sessions.length,
      machineUsage: Array.from(machineUsageMap.values()),
      totalDurationMinutes,
    };
  }
}
