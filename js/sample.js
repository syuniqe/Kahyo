// A pre-extracted sample Journey so the demo works with no key and no mic.
// Loading it runs the same embedding + NSMM scoring as live input.

window.KAHYO_SAMPLE = {
  title: 'The Salt Road',
  stage: 'Pandiculation',
  characters: [
    { name: 'Meera', traits: [{ text: 'Never lies to her brother Arjun', level: 'strict' }] },
    { name: 'Arjun', traits: [{ text: 'Afraid of the open sea', level: 'moderate' }] },
    { name: 'Collector Hale', traits: [{ text: 'Values order over people', level: 'moderate' }] },
  ],
  thoughts: [
    {
      transcript:
        'So it opens in 1930, a salt village on the Gujarat coast. Meera is a salt worker, and the British have taxed salt so heavily that her family cannot afford what they make with their own hands.',
      footsteps: [
        {
          event: 'Meera works the salt pans while the British salt tax crushes her village',
          subjects: ['Meera'],
          context: 'Coastal Gujarat salt village, 1930, under the colonial salt tax',
          plot_intensity: 0.5,
          promises: ['The tax will push the village to breaking point'],
          world_rules: ['Making or selling salt without paying the tax is illegal'],
          intent_signal: 0,
          seeds: [],
        },
      ],
    },
    {
      transcript:
        'Her brother Arjun comes back from Ahmedabad with news that Gandhi is marching to Dandi to make salt in defiance of the law. Meera decides the village should join the march.',
      footsteps: [
        {
          event: 'Arjun returns with news that Gandhi is marching to Dandi to break the salt law',
          subjects: ['Arjun', 'Meera'],
          context: 'Arjun arrives from Ahmedabad at dusk',
          plot_intensity: 0.7,
          promises: ['The march will reach the coast'],
          world_rules: [],
          intent_signal: 0.5,
          seeds: [{ target: 'FS#001', type: 'causal' }],
        },
        {
          event: 'Meera decides the salt village will join the march and defy the salt tax',
          subjects: ['Meera'],
          context: 'A village meeting under the banyan tree',
          plot_intensity: 0.8,
          promises: ['The village will face the Collector'],
          world_rules: [],
          intent_signal: 0.5,
          seeds: [{ target: 'NEW1', type: 'causal' }],
        },
      ],
    },
    {
      transcript:
        'Collector Hale hears of it and orders the salt pans guarded. He offers Meera a deal: give him the names of the organisers and her family keeps their land.',
      footsteps: [
        {
          event: 'Collector Hale orders soldiers to guard the salt pans against the marchers',
          subjects: ['Collector Hale'],
          context: 'District office, the night before the march arrives',
          plot_intensity: 0.7,
          promises: ['Soldiers and marchers will meet at the salt pans'],
          world_rules: ['Soldiers guard the salt pans'],
          intent_signal: 0.5,
          seeds: [{ target: 'FS#003', type: 'causal' }],
        },
        {
          event: 'Hale offers Meera her family land in exchange for the names of the march organisers',
          subjects: ['Collector Hale', 'Meera'],
          context: 'A private meeting at the district office',
          plot_intensity: 0.8,
          promises: ['Meera must choose between her family and the march'],
          world_rules: [],
          intent_signal: 0.5,
          seeds: [{ target: 'NEW1', type: 'causal' }],
        },
      ],
    },
    {
      transcript:
        'What if, just exploring, there is a whole chapter where Arjun was once a sailor on a merchant ship to Zanzibar and we follow his voyage across the ocean, storms, the spice markets, a lover in port.',
      footsteps: [
        {
          event: 'Arjun sails a merchant ship to Zanzibar through ocean storms, spice markets and a lover in port',
          subjects: ['Arjun'],
          context: 'Years earlier, aboard a dhow crossing the Indian Ocean to Zanzibar',
          plot_intensity: 0.3,
          promises: [],
          world_rules: [],
          intent_signal: -1,
          seeds: [],
        },
      ],
    },
    {
      transcript:
        'Arjun asks Meera if she met the Collector, and she tells him no, she never went.',
      footsteps: [
        {
          event: 'Meera lies to Arjun and says she never met Collector Hale',
          subjects: ['Meera', 'Arjun'],
          context: 'At home, late at night, by the lamp',
          plot_intensity: 0.7,
          promises: ['Arjun will discover the lie'],
          world_rules: [],
          intent_signal: 0,
          seeds: [{ target: 'FS#005', type: 'character_arc' }],
          violations: [
            {
              character: 'Meera',
              trait: 'Never lies to her brother Arjun',
              severity: 'hard',
              suggestion:
                'Have Meera stay silent or deflect instead of lying, or mark this as the moment the trait breaks and show what it costs her.',
            },
          ],
        },
      ],
    },
    {
      transcript:
        'Then the climax: the march reaches the coast, Meera refuses Hale and leads the village onto the salt pans to make salt in front of the soldiers.',
      footsteps: [
        {
          event: 'Meera refuses Hale and leads the village onto the guarded salt pans to make salt in defiance',
          subjects: ['Meera', 'Collector Hale'],
          context: 'The salt pans at dawn as the march reaches the coast',
          plot_intensity: 1.0,
          promises: [],
          world_rules: [],
          intent_signal: 1,
          seeds: [
            { target: 'FS#005', type: 'setup_resolution' },
            { target: 'FS#004', type: 'causal' },
          ],
        },
      ],
    },
  ],
};
